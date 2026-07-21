#ifndef FLASH_FS_HPP
#define FLASH_FS_HPP

#include <Arduino.h>
#include <VFS.h>
#include <LittleFS.h>

namespace FlashFS {

    void begin()
    {
        LittleFS.begin();
        VFS.root(LittleFS);
        DEBUG_PRINTLN("LittleFS initialized.");
    }

    bool exists(const char* filename)
    {
        return LittleFS.exists(filename);
    }
} // namespace FlashFS

#endif // FLASH_FS_HPP
