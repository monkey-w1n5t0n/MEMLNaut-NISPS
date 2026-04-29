// firmware/glue/input_router.hpp — High-level input wiring entry point.
//
// Currently a thin re-export over `peripherals.hpp`. The intent is for this
// to grow into a schema-aware router (read mode.param_schema().input_channels
// names, look up matching hardware sources by name, attach callbacks). For
// now the trivial positional mapping in `bind_peripherals()` is sufficient
// since every existing mode's first N channels are joystick X/Y/Z(/W).
//
// Kept as its own header so growth of routing logic doesn't bloat
// peripherals.hpp.

#pragma once

#include "peripherals.hpp"

namespace nisps_firmware {

template <typename Mode>
inline void wire_inputs(Mode& mode) {
    bind_peripherals(mode);
}

}  // namespace nisps_firmware
