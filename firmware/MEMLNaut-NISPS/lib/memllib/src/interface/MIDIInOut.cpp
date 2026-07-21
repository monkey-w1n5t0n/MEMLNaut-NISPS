#include "MIDIInOut.hpp"
#include <Arduino.h>
#include "../PicoDefs.hpp"
#include <unordered_set>
#include "hardware/dma.h"



struct CustomMIDISettings : public midi::DefaultSettings {
    static const bool UseRunningStatus = false;
    static const bool Use1ByteParsing = false;  // Add this line
    static const long BaudRate = 31250;
};

MIDI_CREATE_CUSTOM_INSTANCE(HardwareSerial, Serial2, MIDI, CustomMIDISettings);


#ifdef MIDI_USB_CLIENT
#include <Adafruit_TinyUSB.h>
Adafruit_USBD_MIDI usb_midi;
MIDI_CREATE_INSTANCE(Adafruit_USBD_MIDI, usb_midi, USBMIDI);
#endif


MIDIInOut* MIDIInOut::instance_ = nullptr;

MIDIInOut::MIDIInOut() : n_outputs_(0),
                         cc_callback_(nullptr),
                         note_callback_(nullptr),
                         send_channel_(1),
                         note_channel_(1),
                         refresh_uart_(false),
                         use_advanced_mappings_(false),
                         tx_dma_channel_(-1),
                         dma_busy_(false),
                         midi_tx_pin_(0),
                         rx_dma_channel_(-1),
                         rx_read_pos_(0),
                         parser_state_(0),
                         parser_status_(0),
                         parser_index_(0),
                         running_status_(0),
                         msg_write_pos_(0),
                         msg_read_pos_(0),
                         max_messages_per_poll_(16),
                         max_bytes_per_poll_(64),
                         track_changes_(true),
                         queue_write_pos_(0) {
    instance_ = this;
    memset(tx_dma_buffer_, 0, sizeof(tx_dma_buffer_));
    memset(rx_dma_buffer_, 0, sizeof(rx_dma_buffer_));
    memset(parser_data_, 0, sizeof(parser_data_));
    memset(msg_queue_, 0, sizeof(msg_queue_));
    memset(midi_queue_buffer_, 0, sizeof(midi_queue_buffer_));
#ifdef MIDI_USB_CLIENT
    // TinyUSB setup - must be before Serial
    TinyUSBDevice.setManufacturerDescriptor("ELI");
    TinyUSBDevice.setProductDescriptor("MEMLNaut MIDI");
#endif
}

MIDIInOut::~MIDIInOut() {
    // Clean up DMA channels if allocated
    if (tx_dma_channel_ >= 0) {
        dma_channel_abort(tx_dma_channel_);
        dma_channel_unclaim(tx_dma_channel_);
        tx_dma_channel_ = -1;
    }
    if (rx_dma_channel_ >= 0) {
        dma_channel_abort(rx_dma_channel_);
        dma_channel_unclaim(rx_dma_channel_);
        rx_dma_channel_ = -1;
    }
}

void MIDIInOut::Setup(size_t n_outputs,
    bool midi_through, uint8_t midi_tx, uint8_t midi_rx, bool use_dma_rx) {
    n_outputs_ = n_outputs;
    cc_numbers_.resize(n_outputs);

    // Initialize Serial2 first
    Serial2.end(); // Reset Serial2 state
    delay(10);
    Serial2.setFIFOSize(32); // Set larger FIFO
    Serial2.setTX(midi_tx);
    Serial2.setRX(midi_rx);
    Serial2.begin(31250); // Start MIDI baud rate
    while(!Serial2) { delay(1); } // Wait for Serial2
    delay(100); // Allow port to stabilize

    // Check DMA channel availability before claiming
    int available_channels = 0;
    for (int i = 0; i < NUM_DMA_CHANNELS; i++) {
        if (!dma_channel_is_claimed(i)) {
            available_channels++;
        }
    }
    DEBUG_PRINTF("DMA channels available: %d / %d\n", available_channels, NUM_DMA_CHANNELS);

    // Setup DMA for TX (Serial2 uses uart1 on RP2040)
    midi_tx_pin_ = midi_tx;
    if (!setupTxDMA(uart1)) {
        DEBUG_PRINTLN("Warning: DMA TX setup failed, falling back to regular writes");
    } else {
        DEBUG_PRINTF("DMA TX initialized (channel %d)\n", tx_dma_channel_);
    }

    // Setup DMA for RX only if explicitly requested (to avoid DMA channel conflicts)
    if (use_dma_rx) {
        if (!setupRxDMA(uart1)) {
            DEBUG_PRINTLN("Warning: DMA RX setup failed, falling back to MIDI.read()");
        } else {
            DEBUG_PRINTF("DMA RX initialized (channel %d)\n", rx_dma_channel_);
        }
    } else {
        DEBUG_PRINTLN("MIDI RX using Arduino MIDI library (DMA RX disabled to preserve channels)");
    }

    // Initialize CC numbers to default values [0 .. (n_outputs-1)]
    std::vector<int>  midiShitList = {0, 6,7, 8, 10, 32, 38, 39,41, 43};

    std::unordered_set<int> excludeSet(midiShitList.begin(), midiShitList.end());
    std::vector<int> ccnums;
    ccnums.reserve(127 - midiShitList.size()); // pre-allocate

    for(int i = 0; i < 127; i++) {
        if(excludeSet.find(i) == excludeSet.end()) {
            ccnums.push_back(i);
        }
    }

    cc_numbers_.resize(ccnums.size());
    for(size_t i=0; i < ccnums.size();i++) {
        cc_numbers_[i] = static_cast<uint8_t>(ccnums[i]);
    }

    // Initialize change tracking with invalid values to force first send
    last_sent_values_.resize(n_outputs_, 0xFF);

    if (midi_through) {
        // Enable MIDI thru if requested
        MIDI.turnThruOn();
    } else {
        // Disable MIDI thru to prevent loop-back
        MIDI.turnThruOff();
    }

    // Setup static callbacks
    MIDI.setHandleControlChange(handleControlChange);
    MIDI.setHandleNoteOn(handleNoteOn);
    MIDI.setHandleNoteOff(handleNoteOff);
    MIDI.begin(MIDI_CHANNEL_OMNI);
    delay(100); // Allow MIDI to initialize

    // // Test sending messages with memory barriers
    // MEMORY_BARRIER();
    // MIDI.sendNoteOn(60, 127, 1);
    // Serial2.flush();
    // delay(1);
    // MIDI.sendNoteOff(60, 0, 1);
    // Serial2.flush();
    // delay(1);
    // MIDI.sendControlChange(102, 127, 1);
    // Serial2.flush();
    // delay(1);
    // MIDI.sendControlChange(102, 0, 1);
    // Serial2.flush();
    // MEMORY_BARRIER();

#ifdef MIDI_USB_CLIENT
    USBMIDI.begin(MIDI_CHANNEL_OMNI);
    
    // Set up callbacks for incoming MIDI
    USBMIDI.setHandleNoteOn(handleNoteOn);
    USBMIDI.setHandleNoteOff(handleNoteOff);
    MIDI.setHandleControlChange(handleControlChange);    

#endif    

     DEBUG_PRINTLN("MIDI setup complete");
    // Serial2.flush();  // Ensure the message is sent completely
}

void MIDIInOut::Poll()
{
    // Use DMA-based processing if available
    if (rx_dma_channel_ >= 0) {
        // Process incoming bytes from DMA buffer
        processRxBuffer();

        // Process queued messages with rate limiting
        processQueuedMessages();
    } else {
        // Non-DMA path: Read from Serial2 directly with rate limiting
        // Process limited number of bytes per poll to prevent blocking
        uint32_t bytes_processed = 0;

        while (Serial2.available() && bytes_processed < max_bytes_per_poll_) {
            uint8_t byte = Serial2.read();
            processMidiByte(byte);
            bytes_processed++;
        }

        // Process queued messages with rate limiting
        processQueuedMessages();
    }
    // USBMIDI.read();
}


void MIDIInOut::warnSizeMismatch(const char* function_name, size_t expected, size_t actual) const {
    DEBUG_PRINTF("Warning: %s size mismatch (expected %d, got %d)\n", function_name, expected, actual);
}

void MIDIInOut::SetParamCCNumbers(const std::vector<uint8_t>& cc_numbers) {
    if (cc_numbers.size() != n_outputs_) {
        warnSizeMismatch("SetParamCCNumbers", n_outputs_, cc_numbers.size());
    }
    cc_numbers_ = cc_numbers;
}

void MIDIInOut::SendParamsAsMIDICC(std::span<const float> params) {
    // Optimized: Build directly into DMA buffer, skip unchanged values, use running status
    size_t buf_idx = 0;

    if (use_advanced_mappings_) {
        // Use advanced mappings with individual channels and custom scaling
        size_t send_count = std::min(params.size(), std::min(advanced_mappings_.size(), n_outputs_));
        uint8_t last_channel = 0;  // Track channel for running status

        for (size_t i = 0; i < send_count; i++) {
            uint8_t value = scaleValue(params[i], advanced_mappings_[i]);

            // Skip if value hasn't changed
            if (track_changes_ && value == last_sent_values_[i]) {
                continue;
            }
            last_sent_values_[i] = value;

            // Use running status: only send status byte when channel changes
            uint8_t channel = advanced_mappings_[i].channel;
            if (channel != last_channel || buf_idx == 0) {
                tx_dma_buffer_[buf_idx++] = 0xB0 | ((channel - 1) & 0x0F);
                last_channel = channel;
            }

            tx_dma_buffer_[buf_idx++] = advanced_mappings_[i].cc_number & 0x7F;
            tx_dma_buffer_[buf_idx++] = value & 0x7F;

            // Check buffer limit
            if (buf_idx >= DMA_BUFFER_SIZE - 3) break;
        }
    } else {
        // Use simple mappings (all on same channel - maximum running status benefit)
        size_t send_count = std::min(params.size(), std::min(cc_numbers_.size(), n_outputs_));
        uint8_t status_byte = 0xB0 | ((send_channel_ - 1) & 0x0F);
        bool status_sent = false;

        for (size_t i = 0; i < send_count; i++) {
            // Fast clamping and scaling
            float clamped = params[i];
            clamped = (clamped > 1.0f) ? 1.0f : ((clamped < 0.0f) ? 0.0f : clamped);
            uint8_t value = static_cast<uint8_t>(clamped * 127.0f + 0.5f);

            // Skip if value hasn't changed
            if (track_changes_ && value == last_sent_values_[i]) {
                continue;
            }
            last_sent_values_[i] = value;

            // Send status byte only once (running status)
            if (!status_sent) {
                tx_dma_buffer_[buf_idx++] = status_byte;
                status_sent = true;
            }

            tx_dma_buffer_[buf_idx++] = cc_numbers_[i] & 0x7F;
            tx_dma_buffer_[buf_idx++] = value & 0x7F;

            // Check buffer limit
            if (buf_idx >= DMA_BUFFER_SIZE - 3) break;
        }
    }

    // Only send if we have data
    if (buf_idx > 0) {
        if (tx_dma_channel_ >= 0) {
            sendViaDMADirect(buf_idx);  // No memcpy - buffer already built in place
        } else {
            Serial2.write(tx_dma_buffer_, buf_idx);
        }
    }
}

void MIDIInOut::SetAdvancedParamMappings(const std::vector<CCMapping>& mappings) {
    if (mappings.size() != n_outputs_) {
        warnSizeMismatch("SetAdvancedParamMappings", n_outputs_, mappings.size());
    }

    advanced_mappings_ = mappings;

    // Validate and fix mappings for efficiency
    for (size_t i = 0; i < advanced_mappings_.size(); i++) {
        // Ensure valid ranges
        if (advanced_mappings_[i].channel < 1 || advanced_mappings_[i].channel > 16) {
            advanced_mappings_[i].channel = 1;
        }
        if (advanced_mappings_[i].cc_number > 127) {
            advanced_mappings_[i].cc_number = 127;
        }
        if (advanced_mappings_[i].min_value > 127) {
            advanced_mappings_[i].min_value = 127;
        }
        if (advanced_mappings_[i].max_value > 127) {
            advanced_mappings_[i].max_value = 127;
        }
        // Recompute scale factor in case values were clamped
        uint8_t range = advanced_mappings_[i].max_value - advanced_mappings_[i].min_value;
        advanced_mappings_[i].scale_factor = range;
    }

    use_advanced_mappings_ = true;
}

void MIDIInOut::SetParamMapping(size_t index, uint8_t cc_number, uint8_t channel, uint8_t min_value, uint8_t max_value) {
    if (index >= n_outputs_) {
        DEBUG_PRINTF("Warning: Parameter index %d out of range (max %d)\n", index, n_outputs_ - 1);
        return;
    }

    // Initialize advanced_mappings_ if not already done
    if (advanced_mappings_.size() != n_outputs_) {
        advanced_mappings_.resize(n_outputs_);
    }

    // Validate and clamp values using bit operations for efficiency
    channel = (channel < 1) ? 1 : ((channel > 16) ? 16 : channel);
    cc_number = (cc_number > 127) ? 127 : cc_number;
    min_value = (min_value > 127) ? 127 : min_value;
    max_value = (max_value > 127) ? 127 : max_value;

    advanced_mappings_[index] = CCMapping(cc_number, channel, min_value, max_value);
    use_advanced_mappings_ = true;
}

void MIDIInOut::ClearAdvancedMappings() {
    use_advanced_mappings_ = false;
}

void MIDIInOut::SetMIDISendChannel(uint8_t channel) {
    // Ensure channel is in valid range (1-16)
    if (channel < 1 || channel > 16) {
        DEBUG_PRINTF("Warning: Invalid MIDI channel %d (must be 1-16)\n", channel);
        return;
    }
    send_channel_ = channel;
}

void MIDIInOut::SetMIDINoteChannel(uint8_t channel) {
    // Ensure channel is in valid range (1-16)
    if (channel < 1 || channel > 16) {
        DEBUG_PRINTF("Warning: Invalid MIDI note channel %d (must be 1-16)\n", channel);
        return;
    }
    note_channel_ = channel;
}

void MIDIInOut::SetCCCallback(midi_cc_callback_t callback) {
    cc_callback_ = callback;
}

void MIDIInOut::SetNoteCallback(midi_note_callback_t callback) {
    note_callback_ = callback;
}

// Static callback implementations
void MIDIInOut::handleControlChange(byte channel, byte number, byte value) {
    if (instance_ && instance_->cc_callback_) {
        instance_->cc_callback_(number, value);
    }
}

void MIDIInOut::handleNoteOn(byte channel, byte note, byte velocity) {
    if (instance_ && instance_->note_callback_) {
        instance_->note_callback_(true, note, velocity);
    }
}

void MIDIInOut::handleNoteOff(byte channel, byte note, byte velocity) {
    if (instance_ && instance_->note_callback_) {
        instance_->note_callback_(false, note, velocity);
    }
}

void MIDIInOut::RefreshUART_(void) {
    if (!READ_VOLATILE(refresh_uart_)) {
        Serial2.end(); // Reset Serial2 state
        //delay(10);
        Serial2.setFIFOSize(32); // Set larger FIFO
        Serial2.setTX(Pins::MIDI_TX);
        Serial2.setRX(Pins::MIDI_RX);
        Serial2.begin(31250); // Start MIDI baud rate
        while(!Serial2) {} // Wait for Serial2
        WRITE_VOLATILE(refresh_uart_, true);

        DEBUG_PRINTLN("MIDI UART refreshed.");
    }
}

bool MIDIInOut::sendNoteOn(uint8_t note_number, uint8_t velocity) {
    if (note_number > 127 || velocity > 127) {
        return false;
    }

    // RefreshUART_(); // Refresh UART if needed

    // while(!Serial2) { delay(1); } // Wait for Serial2
    MIDI.sendNoteOn(note_number, velocity, note_channel_);
    // MEMORY_BARRIER();
    return true;
}

bool MIDIInOut::sendNoteOff(uint8_t note_number, uint8_t velocity) {
    if (note_number > 127 || velocity > 127) {
        return false;
    }

    RefreshUART_(); // Refresh UART if needed

    while(!Serial2) { delay(1); } // Wait for Serial2
    MIDI.sendNoteOff(note_number, velocity, note_channel_);
    MEMORY_BARRIER();
    return true;
}

// Buffered MIDI queue implementation
bool MIDIInOut::queueNoteOn(uint8_t note, uint8_t velocity) {
    if (note > 127 || velocity > 127) {
        return false;
    }

    // Auto-flush if not enough space
    if (queue_write_pos_ + 3 > MIDI_QUEUE_BUFFER_SIZE) {
        flushQueue();
    }

    midi_queue_buffer_[queue_write_pos_++] = 0x90 | ((note_channel_ - 1) & 0x0F);
    midi_queue_buffer_[queue_write_pos_++] = note & 0x7F;
    midi_queue_buffer_[queue_write_pos_++] = velocity & 0x7F;

    return true;
}

bool MIDIInOut::queueNoteOff(uint8_t note, uint8_t velocity) {
    if (note > 127 || velocity > 127) {
        return false;
    }

    // Auto-flush if not enough space
    if (queue_write_pos_ + 3 > MIDI_QUEUE_BUFFER_SIZE) {
        flushQueue();
    }

    midi_queue_buffer_[queue_write_pos_++] = 0x80 | ((note_channel_ - 1) & 0x0F);
    midi_queue_buffer_[queue_write_pos_++] = note & 0x7F;
    midi_queue_buffer_[queue_write_pos_++] = velocity & 0x7F;

    return true;
}


bool MIDIInOut::queueClock() {
    if (queue_write_pos_ + 1 > MIDI_QUEUE_BUFFER_SIZE) {
        flushQueue();
    }
    midi_queue_buffer_[queue_write_pos_++] = 0xF8 ;
    return true;
}
bool MIDIInOut::queueClockStart() {
    if (queue_write_pos_ + 1 > MIDI_QUEUE_BUFFER_SIZE) {
        flushQueue();
    }
    midi_queue_buffer_[queue_write_pos_++] = 0xFA ;
    return true;
}


bool MIDIInOut::queueClockStop() {
    if (queue_write_pos_ + 1 > MIDI_QUEUE_BUFFER_SIZE) {
        flushQueue();
    }
    midi_queue_buffer_[queue_write_pos_++] = 0xFC ;
    return true;
}


bool MIDIInOut::queueCC(uint8_t cc_number, uint8_t value) {
    if (cc_number > 127 || value > 127) {
        return false;
    }

    // Auto-flush if not enough space
    if (queue_write_pos_ + 3 > MIDI_QUEUE_BUFFER_SIZE) {
        flushQueue();
    }

    midi_queue_buffer_[queue_write_pos_++] = 0xB0 | ((send_channel_ - 1) & 0x0F);
    midi_queue_buffer_[queue_write_pos_++] = cc_number & 0x7F;
    midi_queue_buffer_[queue_write_pos_++] = value & 0x7F;

    return true;
}

size_t MIDIInOut::flushQueue() {
    if (queue_write_pos_ == 0) {
        return 0;  // Nothing to send
    }

    size_t bytes_to_send = queue_write_pos_;

    // Wait for any existing DMA to complete
    waitForDMA();

    // Copy queue to DMA buffer
    memcpy(tx_dma_buffer_, midi_queue_buffer_, bytes_to_send);

    // Send via DMA or fallback to Serial2
    if (tx_dma_channel_ >= 0) {
        sendViaDMADirect(bytes_to_send);
    } else {
        Serial2.write(tx_dma_buffer_, bytes_to_send);
    }

    // Reset queue position
    queue_write_pos_ = 0;

    return bytes_to_send;
}

// DMA Implementation
bool MIDIInOut::setupTxDMA(uart_inst_t* uart) {
    // Claim DMA channel (don't panic on failure)
    tx_dma_channel_ = dma_claim_unused_channel(false);
    if (tx_dma_channel_ < 0) {
        return false;  // No DMA channel available
    }

    // Configure TX data channel
    dma_channel_config c = dma_channel_get_default_config(tx_dma_channel_);
    channel_config_set_transfer_data_size(&c, DMA_SIZE_8);
    channel_config_set_read_increment(&c, true);   // Increment read address
    channel_config_set_write_increment(&c, false); // Always write to UART DR
    channel_config_set_dreq(&c, uart_get_dreq(uart, true));  // UART TX DREQ

    dma_channel_configure(
        tx_dma_channel_,
        &c,
        &uart_get_hw(uart)->dr,        // Write to UART data register
        NULL,                           // Read address set later
        0,                              // Transfer count set later
        false                           // Don't start yet
    );

    dma_busy_ = false;
    return true;
}

void MIDIInOut::sendViaDMA(const uint8_t* data, size_t length) {
    if (tx_dma_channel_ < 0 || length == 0 || length > DMA_BUFFER_SIZE) {
        return;  // DMA not available or invalid length
    }

    // Wait for previous transfer to complete
    waitForDMA();

    // Copy data to DMA buffer
    memcpy(tx_dma_buffer_, data, length);

    // Start DMA transfer
    dma_busy_ = true;
    dma_channel_set_read_addr(tx_dma_channel_, tx_dma_buffer_, false);
    dma_channel_set_trans_count(tx_dma_channel_, length, true);  // Start immediately
}

void MIDIInOut::sendViaDMADirect(size_t length) {
    if (tx_dma_channel_ < 0 || length == 0 || length > DMA_BUFFER_SIZE) {
        return;  // DMA not available or invalid length
    }

    // Wait for previous transfer to complete
    waitForDMA();

    // Start DMA transfer directly from buffer (no memcpy needed)
    dma_busy_ = true;
    dma_channel_set_read_addr(tx_dma_channel_, tx_dma_buffer_, false);
    dma_channel_set_trans_count(tx_dma_channel_, length, true);  // Start immediately
}

void MIDIInOut::waitForDMA() {
    if (tx_dma_channel_ < 0 || !dma_busy_) {
        return;
    }

    // Wait for DMA to complete
    while (dma_channel_is_busy(tx_dma_channel_)) {
        tight_loop_contents();
    }

    dma_busy_ = false;
}

void MIDIInOut::sendRawBytes(const uint8_t* data, size_t length) {
    if (length == 0) return;
    if (tx_dma_channel_ >= 0) {
        sendViaDMA(data, length);
    } else {
        Serial2.write(data, length);
    }
}

// RX DMA Implementation
bool MIDIInOut::setupRxDMA(uart_inst_t* uart) {
    // Claim DMA channel for RX (don't panic on failure)
    rx_dma_channel_ = dma_claim_unused_channel(false);
    if (rx_dma_channel_ < 0) {
        return false;  // No DMA channel available
    }

    // Configure RX DMA with ring buffer
    dma_channel_config c = dma_channel_get_default_config(rx_dma_channel_);
    channel_config_set_transfer_data_size(&c, DMA_SIZE_8);
    channel_config_set_read_increment(&c, false);  // Always read from UART DR
    channel_config_set_write_increment(&c, true);  // Increment write address
    channel_config_set_dreq(&c, uart_get_dreq(uart, false));  // UART RX DREQ

    // Enable ring buffer on write (wraps at RX_BUFFER_SIZE)
    uint32_t ring_size = 0;
    uint32_t size = RX_BUFFER_SIZE;
    while (size >>= 1) ring_size++;
    channel_config_set_ring(&c, true, ring_size);  // true = wrap on write

    // Start the DMA channel
    dma_channel_configure(
        rx_dma_channel_,
        &c,
        rx_dma_buffer_,                 // Write to rx_buffer
        &uart_get_hw(uart)->dr,         // Read from UART data register
        0xFFFFFFFF,                     // Transfer count (infinite with ring)
        true                            // Start immediately
    );

    return true;
}

uint32_t MIDIInOut::getRxWritePos() {
    // Calculate current write position from DMA transfer count
    uint32_t remaining = dma_channel_hw_addr(rx_dma_channel_)->transfer_count;
    return (0xFFFFFFFF - remaining) & (RX_BUFFER_SIZE - 1);
}

void MIDIInOut::processRxBuffer() {
    uint32_t write_pos = getRxWritePos();

    // Process all available bytes
    while (rx_read_pos_ != write_pos) {
        uint8_t byte = rx_dma_buffer_[rx_read_pos_];
        rx_read_pos_ = (rx_read_pos_ + 1) & (RX_BUFFER_SIZE - 1);

        processMidiByte(byte);
    }
}

unsigned long medianOf3(unsigned long a, unsigned long b, unsigned long c) {
    if (a > b) std::swap(a, b);
    if (b > c) std::swap(b, c);
    if (a > b) std::swap(a, b);
    return b;
}

int counter=0;
void MIDIInOut::updateTempoEstimate() {
    unsigned long now = micros();
    unsigned long delta = now - midiClockTS;
    if (delta < 100)
    {
        delta = deltaTMinus1; // Ignore unrealistic short intervals (could be due to jitter)
    }
    unsigned long deltaSmoothed = medianOf3(deltaTMinus1, deltaTMinus2, delta);
    if (deltaSmoothed > 0.f) {
        float ticksPerSecond = 1000000.f/deltaSmoothed;
        static float lastBPM = 140.f;
        float bpm = ticksPerSecond * 60.f / 24.f;
        if (fabs(bpm - lastBPM) > 0.1f) {
            lastBPM = bpm;
            if (bpm_callback_) {
                bpm_callback_(bpm);
            }
        }
    }
    counter++;
    if (counter >= 12) { 
        // Serial.printf("---------Estimated BPM: %.2f, %f\n", bpm, deltaSmoothed);
        counter = 0;
    };
    deltaTMinus2 = deltaTMinus1;
    deltaTMinus1 = delta;
    midiClockTS = now;
}

void MIDIInOut::processMidiByte(uint8_t byte) {
    // Check if this is a status byte
    if (byte & 0x80) {
        // System Real-Time messages (single byte, can interrupt other messages)
        if (byte == 0xF8) {
            updateTempoEstimate();
            return;
        }
        if (byte == 0xFA) {
            if (transport_callback_) {
                transport_callback_(true);  // Start
            }
            return;
        }  
        if (byte == 0xFC) {
            if (transport_callback_) {
                transport_callback_(false);  // Stop
            }
            return;
        }

        // System Common messages or Channel Voice messages
        parser_status_ = byte;
        parser_index_ = 0;

        // Determine expected data bytes
        uint8_t msg_type = byte & 0xF0;

        if (msg_type == 0xF0) {
            // System messages - ignore SysEx for this implementation
            if (byte == 0xF0) {
                parser_state_ = 0xFF;  // Ignore until 0xF7
            }
            return;
        }

        // Channel voice message
        running_status_ = parser_status_;

    } else if (parser_status_ == 0 && running_status_ != 0) {
        // Use running status
        parser_status_ = running_status_;
        parser_index_ = 0;
    }

    // Ignore if in SysEx ignore mode
    if (parser_state_ == 0xFF) {
        if (byte == 0xF7) parser_state_ = 0;
        return;
    }

    // Process data bytes
    if (!(byte & 0x80) && parser_status_ != 0) {
        uint8_t msg_type = parser_status_ & 0xF0;

        // Determine how many data bytes we need
        uint8_t expected_bytes = 2;
        if (msg_type == 0xC0 || msg_type == 0xD0) {  // Program Change or Channel Aftertouch
            expected_bytes = 1;
        }

        parser_data_[parser_index_++] = byte;

        if (parser_index_ >= expected_bytes) {
            // Complete message received - queue it
            uint8_t channel = (parser_status_ & 0x0F) + 1;  // 1-16
            uint8_t data2 = (expected_bytes > 1) ? parser_data_[1] : 0;

            queueMessage(msg_type, channel, parser_data_[0], data2);

            // Reset for next message (but keep running status)
            parser_index_ = 0;
        }
    }
}

void MIDIInOut::queueMessage(uint8_t type, uint8_t channel, uint8_t data1, uint8_t data2) {
    // Add message to queue
    uint32_t next_pos = (msg_write_pos_ + 1) % MSG_QUEUE_SIZE;

    // Check if queue is full (drop message if full)
    if (next_pos == msg_read_pos_) {
        return;  // Queue full, drop message
    }

    msg_queue_[msg_write_pos_].type = type;
    msg_queue_[msg_write_pos_].channel = channel;
    msg_queue_[msg_write_pos_].data1 = data1;
    msg_queue_[msg_write_pos_].data2 = data2;

    msg_write_pos_ = next_pos;
}

void MIDIInOut::processQueuedMessages() {
    uint32_t processed = 0;

    // Process messages up to the limit
    while (msg_read_pos_ != msg_write_pos_) {
        // Check rate limit
        if (max_messages_per_poll_ > 0 && processed >= max_messages_per_poll_) {
            break;  // Hit rate limit, process more next time
        }

        const MIDIMessage& msg = msg_queue_[msg_read_pos_];
        msg_read_pos_ = (msg_read_pos_ + 1) % MSG_QUEUE_SIZE;
        processed++;

        // Call appropriate callback
        switch (msg.type) {
            case 0x90:  // Note On
                if (msg.data2 == 0) {
                    // Velocity 0 = Note Off
                    if (note_callback_) {
                        note_callback_(false, msg.data1, 0);
                    }
                } else {
                    if (note_callback_) {
                        note_callback_(true, msg.data1, msg.data2);
                    }
                }
                break;

            case 0x80:  // Note Off
                if (note_callback_) {
                    note_callback_(false, msg.data1, msg.data2);
                }
                break;

            case 0xB0:  // Control Change
                if (cc_callback_) {
                    cc_callback_(msg.data1, msg.data2);
                }
                break;

            // Add more message types as needed
        }
    }
}
