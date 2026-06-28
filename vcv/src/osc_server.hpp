// osc_server.hpp — Minimal OSC server for MEMLNaut VCV module
// Lightweight header-only implementation using raw UDP sockets.
// Supports a tiny subset of OSC: float and string arguments only.
// No bundles, no timetags, no pattern matching.
#pragma once

#include <string>
#include <functional>
#include <thread>
#include <atomic>
#include <vector>
#include <cstring>
#include <cstdint>
#include <mutex>
#include <chrono>

#ifdef _WIN32
  #ifndef WIN32_LEAN_AND_MEAN
    #define WIN32_LEAN_AND_MEAN
  #endif
  #include <winsock2.h>
  #include <ws2tcpip.h>
  #pragma comment(lib, "ws2_32.lib")
  using socket_t = SOCKET;
  static constexpr socket_t INVALID_SOCK = INVALID_SOCKET;
  #define CLOSE_SOCKET(s) closesocket(s)
#else
  #include <sys/socket.h>
  #include <netinet/in.h>
  #include <unistd.h>
  #include <arpa/inet.h>
  #include <fcntl.h>
  #include <cerrno>
  using socket_t = int;
  static constexpr socket_t INVALID_SOCK = -1;
  #define CLOSE_SOCKET(s) ::close(s)
#endif

namespace memlnaut {

// ── OSC encoding/decoding helpers ────────────────────────────────────

namespace osc {

// Pad length to next multiple of 4
inline size_t padded(size_t len) {
    return (len + 3) & ~size_t(3);
}

// Read a null-terminated, 4-byte-padded OSC string from buf at offset.
// Returns the string and advances offset past the padded data.
inline std::string readString(const uint8_t* buf, size_t bufLen, size_t& offset) {
    if (offset >= bufLen) return "";
    const char* start = reinterpret_cast<const char*>(buf + offset);
    size_t maxLen = bufLen - offset;
    size_t slen = strnlen(start, maxLen);
    std::string s(start, slen);
    offset += padded(slen + 1); // +1 for null terminator
    return s;
}

// Read a big-endian float32 from buf at offset.
inline float readFloat(const uint8_t* buf, size_t bufLen, size_t& offset) {
    if (offset + 4 > bufLen) return 0.f;
    uint32_t raw = (uint32_t(buf[offset]) << 24)
                 | (uint32_t(buf[offset + 1]) << 16)
                 | (uint32_t(buf[offset + 2]) << 8)
                 | uint32_t(buf[offset + 3]);
    offset += 4;
    float f;
    std::memcpy(&f, &raw, 4);
    return f;
}

// Read a big-endian int32 from buf at offset.
inline int32_t readInt32(const uint8_t* buf, size_t bufLen, size_t& offset) {
    if (offset + 4 > bufLen) return 0;
    int32_t val = (int32_t(buf[offset]) << 24)
               | (int32_t(buf[offset + 1]) << 16)
               | (int32_t(buf[offset + 2]) << 8)
               | int32_t(buf[offset + 3]);
    offset += 4;
    return val;
}

// Write a null-terminated, 4-byte-padded string into out.
inline void writeString(std::vector<uint8_t>& out, const std::string& s) {
    size_t start = out.size();
    size_t total = padded(s.size() + 1);
    out.resize(start + total, 0);
    std::memcpy(out.data() + start, s.c_str(), s.size());
    // Remaining bytes are already zero (null terminator + padding)
}

// Write a big-endian float32 into out.
inline void writeFloat(std::vector<uint8_t>& out, float f) {
    uint32_t raw;
    std::memcpy(&raw, &f, 4);
    out.push_back(uint8_t(raw >> 24));
    out.push_back(uint8_t(raw >> 16));
    out.push_back(uint8_t(raw >> 8));
    out.push_back(uint8_t(raw));
}

// Build an OSC message with a float array payload.
// Address: e.g. "/nisps/output"
// Type tag string: ",fff..." (one 'f' per float)
inline std::vector<uint8_t> messageFloats(const std::string& address,
                                           const float* values, size_t count) {
    std::vector<uint8_t> msg;
    writeString(msg, address);
    // Type tag string: "," + count 'f' chars
    std::string tags = ",";
    for (size_t i = 0; i < count; i++) tags += 'f';
    writeString(msg, tags);
    for (size_t i = 0; i < count; i++) {
        writeFloat(msg, values[i]);
    }
    return msg;
}

// Build an OSC message with a single string payload.
inline std::vector<uint8_t> messageString(const std::string& address,
                                           const std::string& value) {
    std::vector<uint8_t> msg;
    writeString(msg, address);
    writeString(msg, ",s");
    writeString(msg, value);
    return msg;
}

} // namespace osc

// ── OscServer ────────────────────────────────────────────────────────

class OscServer {
public:
    using StringCallback = std::function<void(const std::string&)>;
    using FloatVecCallback = std::function<void(const std::vector<float>&)>;

    OscServer() = default;
    ~OscServer() { stop(); }

    // Non-copyable
    OscServer(const OscServer&) = delete;
    OscServer& operator=(const OscServer&) = delete;

    // Register handlers before starting.
    //   onState   — full JSON state snapshot   (/nisps/state    <s>)
    //   onWeights — weights-only JSON           (/nisps/weights  <s>)
    //   onInput   — live input vector (browser drives the model) (/nisps/input <f…f>)
    //   onFeedback— verdict op JSON (thumbs/place/rand/clear)     (/nisps/feedback <s>)
    void onState(StringCallback cb) { stateCallback_ = std::move(cb); }
    void onWeights(StringCallback cb) { weightsCallback_ = std::move(cb); }
    void onInput(FloatVecCallback cb) { inputCallback_ = std::move(cb); }
    void onFeedback(StringCallback cb) { feedbackCallback_ = std::move(cb); }

    // Set the target address for sending (where the webapp bridge listens).
    // Default: 127.0.0.1:9001
    void setSendTarget(const std::string& host, int port) {
        std::lock_guard<std::mutex> lock(sendMutex_);
        sendHost_ = host;
        sendPort_ = port;
        sendTargetDirty_ = true;
    }

    bool start(int listenPort = 9000) {
        if (running_.load()) return true;

#ifdef _WIN32
        WSADATA wsaData;
        if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) return false;
        wsaInit_ = true;
#endif

        recvSock_ = socket(AF_INET, SOCK_DGRAM, 0);
        if (recvSock_ == INVALID_SOCK) return false;

        // Allow address reuse
        int opt = 1;
#ifdef _WIN32
        setsockopt(recvSock_, SOL_SOCKET, SO_REUSEADDR,
                   reinterpret_cast<const char*>(&opt), sizeof(opt));
#else
        setsockopt(recvSock_, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
#endif

        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = INADDR_ANY;
        addr.sin_port = htons(static_cast<uint16_t>(listenPort));

        if (bind(recvSock_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
            CLOSE_SOCKET(recvSock_);
            recvSock_ = INVALID_SOCK;
            return false;
        }

        // Set receive timeout so the thread can check shouldStop
#ifdef _WIN32
        DWORD timeout = 200; // ms
        setsockopt(recvSock_, SOL_SOCKET, SO_RCVTIMEO,
                   reinterpret_cast<const char*>(&timeout), sizeof(timeout));
#else
        struct timeval tv;
        tv.tv_sec = 0;
        tv.tv_usec = 200000; // 200ms
        setsockopt(recvSock_, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
#endif

        // Create send socket
        sendSock_ = socket(AF_INET, SOCK_DGRAM, 0);
        if (sendSock_ == INVALID_SOCK) {
            CLOSE_SOCKET(recvSock_);
            recvSock_ = INVALID_SOCK;
            return false;
        }

        listenPort_ = listenPort;
        shouldStop_.store(false);
        running_.store(true);
        recvThread_ = std::thread(&OscServer::recvLoop, this);
        return true;
    }

    void stop() {
        if (!running_.load()) return;
        shouldStop_.store(true);
        if (recvThread_.joinable()) recvThread_.join();
        if (recvSock_ != INVALID_SOCK) { CLOSE_SOCKET(recvSock_); recvSock_ = INVALID_SOCK; }
        if (sendSock_ != INVALID_SOCK) { CLOSE_SOCKET(sendSock_); sendSock_ = INVALID_SOCK; }
        running_.store(false);

#ifdef _WIN32
        if (wsaInit_) { WSACleanup(); wsaInit_ = false; }
#endif
    }

    bool isRunning() const { return running_.load(); }
    int getPort() const { return listenPort_; }

    // ── Send methods ─────────────────────────────────────────────────

    // Send current output values (12 floats) to the webapp bridge
    void sendOutputs(const float* values, size_t count) {
        auto msg = osc::messageFloats("/nisps/output", values, count);
        sendPacket(msg);
    }

    // Send current input values (N floats)
    void sendInputs(const float* values, size_t count) {
        auto msg = osc::messageFloats("/nisps/input", values, count);
        sendPacket(msg);
    }

    // Send a full JSON state snapshot (module → browser).
    void sendState(const std::string& json) {
        auto msg = osc::messageString("/nisps/state", json);
        sendPacket(msg);
    }

    // Send weights-only JSON (module → browser).
    void sendWeights(const std::string& json) {
        auto msg = osc::messageString("/nisps/weights", json);
        sendPacket(msg);
    }

private:
    void recvLoop() {
        uint8_t buf[65536];
        while (!shouldStop_.load()) {
            sockaddr_in from{};
            socklen_t fromLen = sizeof(from);
            ssize_t n = recvfrom(recvSock_, reinterpret_cast<char*>(buf), sizeof(buf), 0,
                                 reinterpret_cast<sockaddr*>(&from), &fromLen);
            if (n <= 0) continue; // timeout or error

            // Remember sender for replies
            {
                std::lock_guard<std::mutex> lock(sendMutex_);
                lastSender_ = from;
                hasLastSender_ = true;
            }

            parseMessage(buf, static_cast<size_t>(n));
        }
    }

    void parseMessage(const uint8_t* buf, size_t len) {
        size_t offset = 0;

        // Read address
        std::string address = osc::readString(buf, len, offset);
        if (address.empty() || address[0] != '/') return;

        // Read type tag string
        std::string tags = osc::readString(buf, len, offset);
        if (tags.empty() || tags[0] != ',') return;

        // Dispatch based on address
        if (address == "/nisps/state") {
            // Expect a single string argument
            if (tags.size() >= 2 && tags[1] == 's') {
                std::string payload = osc::readString(buf, len, offset);
                if (stateCallback_) stateCallback_(payload);
            }
        } else if (address == "/nisps/weights") {
            // Expect a single string argument (JSON)
            if (tags.size() >= 2 && tags[1] == 's') {
                std::string payload = osc::readString(buf, len, offset);
                if (weightsCallback_) weightsCallback_(payload);
            }
        } else if (address == "/nisps/feedback") {
            // Verdict op as a JSON string:
            //   {"op":"up|down|rand|clear","spread":f,"input":[…],"output":[…]}
            if (tags.size() >= 2 && tags[1] == 's') {
                std::string payload = osc::readString(buf, len, offset);
                if (feedbackCallback_) feedbackCallback_(payload);
            }
        } else if (address == "/nisps/input") {
            // Live input vector from the browser → drive the model inputs.
            std::vector<float> values;
            for (size_t i = 1; i < tags.size(); ++i) {
                if (tags[i] == 'f') values.push_back(osc::readFloat(buf, len, offset));
                else break;
            }
            if (!values.empty() && inputCallback_) inputCallback_(values);
        }
        // Unknown addresses are silently ignored
    }

    void sendPacket(const std::vector<uint8_t>& packet) {
        if (sendSock_ == INVALID_SOCK) return;

        std::lock_guard<std::mutex> lock(sendMutex_);

        sockaddr_in target{};
        target.sin_family = AF_INET;

        if (sendTargetDirty_ || !hasExplicitTarget_) {
            // Use explicit target if set, otherwise reply to last sender
            if (!sendHost_.empty()) {
                inet_pton(AF_INET, sendHost_.c_str(), &target.sin_addr);
                target.sin_port = htons(static_cast<uint16_t>(sendPort_));
                hasExplicitTarget_ = true;
                sendTargetDirty_ = false;
                sendAddr_ = target;
            } else if (hasLastSender_) {
                target = lastSender_;
                target.sin_port = htons(static_cast<uint16_t>(sendPort_));
                sendAddr_ = target;
            } else {
                return; // nobody to send to
            }
        }

        sendto(sendSock_, reinterpret_cast<const char*>(packet.data()), packet.size(), 0,
               reinterpret_cast<sockaddr*>(&sendAddr_), sizeof(sendAddr_));
    }

    // Sockets
    socket_t recvSock_ = INVALID_SOCK;
    socket_t sendSock_ = INVALID_SOCK;
    int listenPort_ = 9000;

    // Thread control
    std::thread recvThread_;
    std::atomic<bool> shouldStop_{false};
    std::atomic<bool> running_{false};

    // Callbacks
    StringCallback stateCallback_;
    StringCallback weightsCallback_;
    StringCallback feedbackCallback_;
    FloatVecCallback inputCallback_;

    // Send target
    std::mutex sendMutex_;
    std::string sendHost_ = "127.0.0.1";
    int sendPort_ = 9001;
    bool sendTargetDirty_ = false;
    bool hasExplicitTarget_ = false;
    bool hasLastSender_ = false;
    sockaddr_in lastSender_{};
    sockaddr_in sendAddr_{};

#ifdef _WIN32
    bool wsaInit_ = false;
#endif
};

} // namespace memlnaut
