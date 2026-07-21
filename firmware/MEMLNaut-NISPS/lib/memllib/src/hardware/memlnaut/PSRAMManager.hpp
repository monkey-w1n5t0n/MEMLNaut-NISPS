#ifndef PSRAM_MANAGER_HPP
#define PSRAM_MANAGER_HPP

#include <hardware/structs/qmi.h>
#include <hardware/structs/xip.h>
#include <hardware/clocks.h>

// PSRAM memory map on RP2350B
// 0x11000000 — cached via XIP L2 (best for hot read-mostly buffers)
// 0x15000000 — uncached/noalloc (direct QMI, no coherence concerns on write)
#define PSRAM_BASE         (reinterpret_cast<uint8_t *>(0x11000000u))
#define PSRAM_BASE_NOCACHE (reinterpret_cast<uint8_t *>(0x15000000u))

// Place PSRAM-backed objects with: uint8_t PSRAM_ATTR myBuf[N];
#define PSRAM_ATTR __attribute__((section(".psram")))

class PSRAMManager {
public:
    // Detect PSRAM and apply fastest stable QMI timing.
    // Call after set_sys_clock_khz(), before any PSRAM access.
    // Returns true if PSRAM was found and configured.
    static bool init() {
        _size = rp2040.getPSRAMSize();
        if (!_size) return false;
        _applyOptimalTiming();
        return true;
    }

    static bool     available()     { return _size > 0; }
    static uint32_t size()          { return _size; }
    static uint8_t* base()          { return PSRAM_BASE; }
    static uint8_t* baseUncached()  { return PSRAM_BASE_NOCACHE; }
    static uint32_t psramClockMHz() { return _psramMHz; }

private:
    inline static uint32_t _size     = 0;
    inline static uint32_t _psramMHz = 0;

    // RXDELAY is counted in sys_clk cycles, not PSRAM cycles.  At 264 MHz,
    // rxd=3 is only 11.4 ns — insufficient for board trace delays — so even
    // div=2 (66 MHz PSRAM) fails.  Empirically verified configurations:
    //   200 MHz sys_clk: div=1 rxd=3  → 100 MHz PSRAM, 33 MB/s
    //   264 MHz sys_clk: div=3 rxd=2  →  44 MHz PSRAM, 17 MB/s
    // Staying at 200 MHz gives substantially better PSRAM throughput.
    static void _applyOptimalTiming() {
        const uint32_t sys_mhz = clock_get_hz(clk_sys) / 1000000u;
        uint32_t div, rxd;
        if (sys_mhz <= 200u) {
            div = 1u; rxd = 3u;   // 100 MHz PSRAM at 200 MHz, sweep-verified
        } else if (sys_mhz <= 264u) {
            div = 3u; rxd = 2u;   // 44 MHz PSRAM at 264 MHz, sweep-verified
        } else {
            div = 4u; rxd = 3u;   // conservative fallback for unknown clocks
        }

        hw_set_bits(&xip_ctrl_hw->ctrl, XIP_CTRL_WRITABLE_M1_BITS);
        uint32_t t = qmi_hw->m[1].timing;
        t &= ~(QMI_M1_TIMING_CLKDIV_BITS | QMI_M1_TIMING_RXDELAY_BITS);
        t |= (div << QMI_M1_TIMING_CLKDIV_LSB) | (rxd << QMI_M1_TIMING_RXDELAY_LSB);
        qmi_hw->m[1].timing = t;

        _psramMHz = sys_mhz / 2u / div;
    }
};

#endif // PSRAM_MANAGER_HPP
