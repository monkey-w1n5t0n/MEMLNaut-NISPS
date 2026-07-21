#ifndef _FM_HPP
#define _FM_HPP
#include <Arduino.h>

#include <cstdint>

#include "maximilian.h"

#include <vector>
#include <array>
#include <cmath>

#include "OnePoleSmoother.hpp"

const size_t kN_synthparams = 14;
using synthparams_array = std::array<float, kN_synthparams>;
static constexpr size_t kN_notes = 4;

template <typename T, std::size_t Capacity>
class RingBuffer {
public:
    RingBuffer() : head_(0), tail_(0), size_(0) {}

    // Push an element to the back of the queue
    bool push_back(const T& value) {
        if (size_ < Capacity) {
            buffer_[tail_] = value;
            tail_ = (tail_ + 1) % Capacity;
            ++size_;
            return true;
        } else {
            // Overwrite the oldest element if at full capacity
            buffer_[tail_] = value;
            tail_ = (tail_ + 1) % Capacity;
            head_ = (head_ + 1) % Capacity;
            return false;
        }
    }

    // Remove an element at a specific position
    bool remove_at(std::size_t index) {
        if (index >= size_) return false;

        std::size_t actual_index = (head_ + index) % Capacity;
        for (std::size_t i = actual_index; i != tail_; i = (i + 1) % Capacity) {
            std::size_t next_index = (i + 1) % Capacity;
            buffer_[i] = buffer_[next_index];
        }
        tail_ = (tail_ + Capacity - 1) % Capacity;
        --size_;
        return true;
    }

    // Remove all elements with the same `note`
    void RemoveNote(const T& target) {
        std::size_t current = 0;
        while (current < size_) {
            std::size_t actual_index = (head_ + current) % Capacity;
            if (buffer_[actual_index].note_number == target.note_number) {
                remove_at(current);
                // Do not increment `current` as the elements after the removed one shift left
            } else {
                ++current;
            }
        }
    }

    // Clear the queue
    void clear() {
        head_ = 0;
        tail_ = 0;
        size_ = 0;
    }

    // Get a pointer to the last element
    T* back() {
        if (size_ == 0) return nullptr;
        std::size_t last_index = (tail_ + Capacity - 1) % Capacity;
        return &buffer_[last_index];
    }

    // Check if the buffer is empty
    bool empty() const {
        return size_ == 0;
    }

    // Get the current size of the buffer
    std::size_t size() const {
        return size_;
    }

private:
    std::array<T, Capacity> buffer_;
    std::size_t head_; // Points to the start of valid data
    std::size_t tail_; // Points to the next insertion point
    std::size_t size_; // Number of valid elements
};


class FMOperator {
public:
    void UpdateParams(void) {
        carrier.UpdateParams();
        modulator.UpdateParams();
    }
    float play(MAXITYPE carrierFreq, MAXITYPE modFreq, MAXITYPE index) {
        float mod = modulator.sinebuf(modFreq);
        float car = carrier.sinebuf(carrierFreq + (mod * index)) ;
        return car;
    }
private:
    maxiOsc carrier, modulator;
};


class FMSynth {
 public:
    static void GenParams(std::vector<float> &param_vector);
    FMSynth(float sample_rate);
    float process();
    int32_t processInt();
    void mapParameters(const std::vector<float> &params);
    // void EnableMIDI(bool en);
    // void AddMIDINote(ts_midi_note note);
    void UpdateParams();

 private:
    FMOperator op1, op2, op3, op4;
    synthparams_array synthparams;
    synthparams_array synthparams_smoothed;
    // FMOperator fmops[10];
    OnePoleSmoother<kN_synthparams> smoother_;

    // MIDI
    // RingBuffer<ts_midi_note, kN_notes> note_buffer_;
    OnePoleSmoother<1> envelope_smoother_;
    float note_freq_;
    float note_amplitude_;
    bool play_note_;
    bool midi_enabled_;
};

#endif  // _FM_HPP