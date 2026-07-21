#include "SDCard.hpp"
#include <SPI.h>
#include "SdFat.h"

SDCard::SDCard(int miso, int mosi, int cs, int sck)
    : miso_(miso), mosi_(mosi), cs_(cs), sck_(sck), cardPresent_(false), cardEventCb_(nullptr) {
    SPI1.setRX(miso_);
    SPI1.setTX(mosi_);
    SPI1.setSCK(sck_);
    Poll();
}

void SDCard::Poll() {
    bool newStatus = sd_.begin(cs_);
    if (newStatus != cardPresent_) {
        cardPresent_ = newStatus;
        if (cardEventCb_) {
            cardEventCb_(cardPresent_);
        }
    }
}

SDCard::CardInfo SDCard::GetCardInfo() {
    CardInfo info = {CardType::UNKNOWN, 0, 0, 0, 0, 0, 0};
    if (!cardPresent_) return info;

    FsVolume* volume = sd_.vol();
    if (volume && volume->fatType() != 0) {
        info.type = CardType::SD2;
        info.blockSize = 512;  // Standard for SD cards
        info.blocksPerCluster = volume->sectorsPerCluster();
        info.clusterSize = info.blockSize * info.blocksPerCluster;
        info.totalBytes = (uint64_t)volume->clusterCount() * info.clusterSize;
        info.fatType = volume->fatType();

        // Calculate used space
        uint32_t freeClusters = volume->freeClusterCount();
        if (freeClusters != 0xFFFFFFFF) {
            uint64_t freeBytes = (uint64_t)freeClusters * info.clusterSize;
            info.usedBytes = info.totalBytes - freeBytes;
        } else {
            info.usedBytes = info.totalBytes / 2;  // Fallback estimate
        }
    }
    return info;
}

bool SDCard::MKDir(const char* path, bool exist_ok) {
    if (!cardPresent_) return false;
    if (sd_.exists(path)) {
        return exist_ok;
    }
    return sd_.mkdir(path);
}

bool SDCard::Write(const char* filename, const std::vector<char>& data) {
    if (!cardPresent_) return false;

    FatFile file;
    if (!file.open(filename, O_RDWR | O_CREAT | O_TRUNC)) return false;

    size_t written = file.write(data.data(), data.size());
    file.close();
    return written == data.size();
}

bool SDCard::Read(const char* filename, std::vector<char>& data, size_t size) {
    if (!cardPresent_) return false;

    FatFile file;
    if (!file.open(filename, O_READ)) return false;

    size_t fileSize = file.fileSize();
    size_t bytesToRead = (size == 0 || size > fileSize) ? fileSize : size;

    data.resize(bytesToRead);
    size_t bytesRead = file.read(data.data(), bytesToRead);
    file.close();

    return bytesRead == bytesToRead;
}

bool SDCard::Touch(const char* filename) {
    if (!cardPresent_) return false;
    if (sd_.exists(filename)) return false;

    FatFile file;
    if (!file.open(filename, O_RDWR | O_CREAT)) return false;

    file.close();
    return true;
}
