#ifndef MEDIANFILTER
#define MEDIANFILTER

#include <vector>
#include <numeric>
#include <functional>
#include <math.h>
#include <algorithm>

template <typename T>
class MedianFilter
{
public:
    MedianFilter(std::size_t filterSize) {
        init(filterSize);
    }

    MedianFilter() {
        init(3);
    }

    void init(std::size_t fSize) {
        filterSize_ = fSize;
        circularBuffer_ = std::vector<T>(filterSize_, 0);
        centreIndex = static_cast<size_t>(fSize / 2);
        reset();
    }

    void reset(T value = 0) {
        std::fill(circularBuffer_.begin(), circularBuffer_.end(), value);
        currentIndex_ = 0;
    }

    T process(T inputValue)
    {

        // Store the new value in the circular buffer
        circularBuffer_[currentIndex_] = inputValue;
        // Move to the next index in the circular buffer
        currentIndex_++;
        if (currentIndex_ == filterSize_) {
          currentIndex_ = 0;
        }

        //copy
        // auto tmpVector = std::copy(circularBuffer_.begin(), circularBuffer_.end());
        auto tmpVector = circularBuffer_;
        std::nth_element(tmpVector.begin(), tmpVector.begin()+centreIndex, tmpVector.end());
        // Calculate and return the moving average
        return tmpVector[centreIndex];
    }

    float std() {
        float sum = std::accumulate(std::begin(circularBuffer_), std::end(circularBuffer_), 0.0);
        float m =  sum / circularBuffer_.size();

        float accum = 0.0;
        std::for_each (std::begin(circularBuffer_), std::end(circularBuffer_), [&](const float d) {
            accum += (d - m) * (d - m);
        });

        return sqrt(accum / (circularBuffer_.size()-1));
    }

private:
    std::size_t filterSize_;
    std::vector<T> circularBuffer_;
    std::size_t currentIndex_ = 0;
    size_t centreIndex=0;
};

#endif