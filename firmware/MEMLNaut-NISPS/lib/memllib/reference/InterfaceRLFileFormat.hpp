#ifndef INTERFACE_RL_FILE_FORMAT_HPP
#define INTERFACE_RL_FILE_FORMAT_HPP

#include <stdint.h>

static constexpr uint16_t MEML_FILE_FORMAT_VERSION = 1;

// Binary file layout:
//   MEMLFileHeader  (26 bytes)
//   extra_size bytes of mode-specific data  (may be 0)
//   MLP binary (existing format)
struct MEMLFileHeader {
    char     magic[4];       // always "MEML"
    uint16_t format_version; // MEML_FILE_FORMAT_VERSION
    char     mode_tag[16];   // null-padded mode identifier, e.g. "VerbFX"
    uint16_t extra_size;     // bytes of mode-specific data immediately following
};

#endif // INTERFACE_RL_FILE_FORMAT_HPP
