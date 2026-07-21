#ifndef __PLAYLOOP_HPP__
#define __PLAYLOOP_HPP__

#include "stdint.h"

#include "../PicoDefs.hpp"


// Flash memory address where audio data is loaded
#define AUDIO_FLASH_ADDRESS    0x10200000U
#define AUDIO_MAGIC            0x4F434950U  // 'PICO'
#define AUDIO_VERSION          1U


class PlayLoop {

public:

    PlayLoop(const char *filename) :
        sample_info_{0},
        phase_(0.f)
    {
        if (!get_sample_info(filename, &sample_info_)) {
            DEBUG_PRINTLN("Error: Sample  not found in audio data.");
        }else{
            DEBUG_PRINTLN("Sample found: " + String(sample_info_.name) + ", count: " + String(sample_info_.sample_count) + ", duration: " + String(sample_info_.duration));
        }
    }

    float __force_inline Process() {
        if (!sample_info_.found || !sample_info_.samples || sample_info_.sample_count == 0) {
            return 0.f; // Return silence if sample not found
        }

        // Read sample at current phase
        float y = sample_info_.samples[phase_];
        // Update phase
        phase_++;
        if (phase_ >= sample_info_.sample_count) {
            phase_ = 0;
        }

        return y;
    }

protected:

    // Sample information structure
    typedef struct {
        const char* name;           // File name
        const float* samples;       // Pointer to audio samples
        uint32_t sample_count;      // Number of samples
        float duration;             // Duration in seconds
        bool found;                 // Whether the file was found
    } sample_info_t;

    // Binary format structures
    typedef struct {
        uint32_t magic;        // 'PICO' magic number
        uint32_t version;      // Format version
        uint32_t file_count;   // Number of audio files
        uint32_t sample_rate;  // Sample rate in Hz
    } audio_header_t;

    typedef struct {
        char name[16];         // Null-terminated filename
        uint32_t offset;       // Offset to audio data
        uint32_t sample_count; // Number of samples
        float duration;        // Duration in seconds
        uint32_t reserved;     // Reserved for future use
    } audio_file_entry_t;

    sample_info_t sample_info_;
    unsigned int phase_;

    /**
     * Get sample information by filename (without .wav extension)
     *
     * @param filename Name of the file without .wav extension (e.g., "intro", "beep")
     * @param info Pointer to sample_info_t structure to fill
     * @return true if file found, false otherwise
     */
    static bool get_sample_info(const char* filename, sample_info_t* info) {
        DEBUG_PRINTLN("get_sample_info called with filename: " + String(filename));
        if (!filename || !info) {
            return false;
        }

        // Initialize info structure
        memset(info, 0, sizeof(sample_info_t));

        // Read pointers from memory based on flash address
        const uint8_t* binary_data = (const uint8_t*)AUDIO_FLASH_ADDRESS;
        const audio_header_t* header = (const audio_header_t*)binary_data;
        const audio_file_entry_t* file_table = (const audio_file_entry_t*)(binary_data + 16);

        // Verify binary is valid
        if (header->magic != AUDIO_MAGIC) {
            return false;
        }

        // Search for the file by name
        for (uint32_t i = 0; i < header->file_count; i++) {
            if (strcmp(file_table[i].name, filename) == 0) {
                // Found the file!
                info->name = file_table[i].name;
                info->samples = (const float*)(binary_data + file_table[i].offset);
                info->sample_count = file_table[i].sample_count;
                info->duration = file_table[i].duration;
                info->found = true;
                return true;
            }
        }

        // File not found
        info->found = false;
        return false;
    }

};



#endif  // __PLAYLOOP_HPP__
