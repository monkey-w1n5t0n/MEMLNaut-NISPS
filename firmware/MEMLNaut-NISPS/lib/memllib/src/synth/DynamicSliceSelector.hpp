#pragma once

#include <vector>
#include <array>
#include <cstdint>
#include <cmath>
#include <algorithm>
#include "pico/critical_section.h"
#include "pico/time.h"

class DynamicSliceSelector {
public:
    static constexpr int kN_Params = 4;
    static constexpr int kMaxSlices = 64;      // Maximum number of slices
    static constexpr int kGridResolution = 16; // 16th note grid
    static constexpr int kPhraseLength = 16;   // 16-beat phrase structure

    struct SlicePoint {
        uint32_t start_sample;
        uint32_t length_samples;
        bool active;
        float probability;
    };

    struct DrumLoop {
        const float* samples;
        uint32_t length_samples;
        uint32_t sample_rate;
    };

private:
    // Parameters (0-1 range)
    float slice_probability_;    // Overall probability of slicing
    float clustering_factor_;    // How much slices cluster together
    float phrase_awareness_;     // How much to respect phrase structure
    float grid_tightness_;       // How strictly to follow the grid

    // Thread-safe double buffer for slice points
    std::array<SlicePoint, kMaxSlices> slice_points_a_;
    std::array<SlicePoint, kMaxSlices> slice_points_b_;
    const std::array<SlicePoint, kMaxSlices>* active_slices_;
    std::array<SlicePoint, kMaxSlices>* update_slices_;

    // Playback state (accessed in ISR)
    uint32_t playback_position_;         // Current position in drum loop
    uint32_t current_slice_idx_;         // Current slice being played
    uint32_t slice_start_position_;      // Where current slice started
    uint32_t slice_end_position_;        // Where current slice ends
    bool slice_transition_pending_;      // Flag for slice boundary crossing

    // Thread synchronization
    critical_section_t cs_;
    volatile bool update_pending_;       // Flag that new slices are ready
    volatile int active_num_slices_;     // Thread-safe copy of slice count

    // Crossfade state for smooth transitions
    static constexpr int kCrossfadeSamples = 64;  // Short crossfade for glitch-free transitions
    float crossfade_buffer_[kCrossfadeSamples];
    int crossfade_position_;
    bool crossfading_;

    // Loop management
    uint32_t loop_start_time_;           // For tempo-sync if needed
    bool loop_active_;

    DrumLoop drum_loop_;

    // Phrase awareness weights (higher = more likely to slice)
    static constexpr std::array<float, kPhraseLength> phrase_weights_ = {
        1.0f, 0.6f, 0.8f, 0.6f,  // Beat 1: strong, off-beats weaker
        0.9f, 0.5f, 0.7f, 0.5f,  // Beat 2: backbeat emphasis
        0.8f, 0.6f, 0.9f, 0.6f,  // Beat 3: syncopation
        1.0f, 0.7f, 0.8f, 0.9f   // Beat 4: build to next phrase
    };

    // Simple PRNG for deterministic behavior
    uint32_t rng_state_;

    float FastRandom() {
        rng_state_ = rng_state_ * 1664525u + 1013904223u;
        return (rng_state_ & 0x00FFFFFF) / float(0x01000000);
    }

    // Fast approximation of exponential function for clustering
    float FastExp(float x) {
        if (x < -5.0f) return 0.0f;
        if (x > 5.0f) return 1.0f;

        // Taylor series approximation for small x
        float x2 = x * x;
        return 1.0f + x + 0.5f * x2 + 0.166667f * x2 * x;
    }

    float CalculateClusteringWeight(int grid_pos, int last_slice_pos) {
        if (last_slice_pos == -1) return 1.0f;

        float distance = abs(grid_pos - last_slice_pos);
        float cluster_strength = clustering_factor_ * 4.0f - 2.0f; // Map to [-2, 2]

        // Exponential decay/growth based on distance
        float weight = FastExp(-cluster_strength * distance * 0.25f);

        // Clamp to reasonable range
        return std::max(0.1f, std::min(2.0f, weight));
    }

    float CalculatePhraseWeight(int grid_pos) {
        int phrase_pos = grid_pos % kPhraseLength;
        float base_weight = phrase_weights_[phrase_pos];

        // Blend with uniform distribution based on phrase_awareness
        return base_weight * phrase_awareness_ + (1.0f - phrase_awareness_);
    }

    void UpdatePlaybackState() {
        // Check if we need to handle slice updates (called from ISR)
        if (update_pending_) {
            // Find current slice based on new slice configuration
            bool found_current_slice = false;

            for (int i = 0; i < active_num_slices_; ++i) {
                if ((*active_slices_)[i].active) {
                    uint32_t slice_start = (*active_slices_)[i].start_sample;
                    uint32_t slice_end = slice_start + (*active_slices_)[i].length_samples;

                    // Check if current playback position falls within this slice
                    if (playback_position_ >= slice_start && playback_position_ < slice_end) {
                        // Only update if we're actually changing slices
                        if (current_slice_idx_ != i) {
                            current_slice_idx_ = i;
                            slice_start_position_ = slice_start;
                            slice_end_position_ = slice_end;

                            // Start crossfade if we're mid-playback
                            if (playback_position_ > slice_start + kCrossfadeSamples) {
                                crossfading_ = true;
                                crossfade_position_ = 0;
                            }
                        }
                        found_current_slice = true;
                        break;
                    }
                }
            }

            // If no slice found, default to first slice
            if (!found_current_slice && active_num_slices_ > 0) {
                current_slice_idx_ = 0;
                slice_start_position_ = (*active_slices_)[0].start_sample;
                slice_end_position_ = slice_start_position_ + (*active_slices_)[0].length_samples;
                playback_position_ = slice_start_position_;
            }

            update_pending_ = false;
        }
    }

    float GetCrossfadedSample(uint32_t pos_a, uint32_t pos_b, float mix) {
        float sample_a = (pos_a < drum_loop_.length_samples) ? drum_loop_.samples[pos_a] : 0.0f;
        float sample_b = (pos_b < drum_loop_.length_samples) ? drum_loop_.samples[pos_b] : 0.0f;

        return sample_a * (1.0f - mix) + sample_b * mix;
    }

    void GenerateSlicePoints() {
        // Work on the update buffer
        auto& slice_points = *update_slices_;
        int num_slices = 0;

        if (drum_loop_.samples == nullptr || drum_loop_.length_samples == 0) {
            return;
        }

        // Calculate samples per grid position
        float samples_per_grid = drum_loop_.length_samples / float(kGridResolution);

        int last_slice_pos = -1;

        // Evaluate each grid position
        for (int grid_pos = 0; grid_pos < kGridResolution && num_slices < kMaxSlices - 1; ++grid_pos) {
            // Calculate base probability factors
            float clustering_weight = CalculateClusteringWeight(grid_pos, last_slice_pos);
            float phrase_weight = CalculatePhraseWeight(grid_pos);

            // Combined probability
            float final_probability = slice_probability_ * clustering_weight * phrase_weight;

            // Clamp probability
            final_probability = std::max(0.0f, std::min(1.0f, final_probability));

            // Probabilistic decision
            if (FastRandom() < final_probability) {
                // Calculate slice start position with optional grid looseness
                float base_sample = grid_pos * samples_per_grid;
                float jitter = (FastRandom() - 0.5f) * samples_per_grid * 0.1f * (1.0f - grid_tightness_);

                uint32_t start_sample = uint32_t(std::max(0.0f, base_sample + jitter));

                // Ensure we don't exceed bounds
                if (start_sample < drum_loop_.length_samples) {
                    slice_points[num_slices].start_sample = start_sample;
                    slice_points[num_slices].active = true;
                    slice_points[num_slices].probability = final_probability;

                    last_slice_pos = grid_pos;
                    num_slices++;
                }
            }
        }

        // Always ensure we have at least one slice at the beginning
        if (num_slices == 0) {
            slice_points[0].start_sample = 0;
            slice_points[0].active = true;
            slice_points[0].probability = 1.0f;
            num_slices = 1;
        }

        // Calculate slice lengths
        for (int i = 0; i < num_slices; ++i) {
            uint32_t next_start = (i + 1 < num_slices) ?
                slice_points[i + 1].start_sample :
                drum_loop_.length_samples;

            slice_points[i].length_samples = next_start - slice_points[i].start_sample;
        }

        // Mark remaining slices as inactive
        for (int i = num_slices; i < kMaxSlices; ++i) {
            slice_points[i].active = false;
        }

        // Atomically update the active buffer
        critical_section_enter_blocking(&cs_);
        std::swap(active_slices_, update_slices_);
        active_num_slices_ = num_slices;
        update_pending_ = true;
        critical_section_exit(&cs_);
    }

public:
    DynamicSliceSelector() :
        slice_probability_(0.5f),
        clustering_factor_(0.5f),
        phrase_awareness_(0.7f),
        grid_tightness_(0.8f),
        active_slices_(&slice_points_a_),
        update_slices_(&slice_points_b_),
        playback_position_(0),
        current_slice_idx_(0),
        slice_start_position_(0),
        slice_end_position_(0),
        slice_transition_pending_(false),
        active_num_slices_(0),
        update_pending_(false),
        crossfade_position_(0),
        crossfading_(false),
        loop_start_time_(0),
        loop_active_(false),
        drum_loop_{nullptr, 0, 44100},
        rng_state_(12345) {

        // Initialize critical section
        critical_section_init(&cs_);

        // Initialize slice points
        for (auto& slice : slice_points_a_) {
            slice.start_sample = 0;
            slice.length_samples = 0;
            slice.active = false;
            slice.probability = 0.0f;
        }

        for (auto& slice : slice_points_b_) {
            slice.start_sample = 0;
            slice.length_samples = 0;
            slice.active = false;
            slice.probability = 0.0f;
        }

        // Initialize crossfade buffer
        for (int i = 0; i < kCrossfadeSamples; ++i) {
            crossfade_buffer_[i] = 0.0f;
        }
    }

    ~DynamicSliceSelector() {
        critical_section_deinit(&cs_);
    }

    void SetDrumLoop(const float* samples, uint32_t length_samples, uint32_t sample_rate = 44100) {
        // This should be called from main thread only
        critical_section_enter_blocking(&cs_);

        drum_loop_.samples = samples;
        drum_loop_.length_samples = length_samples;
        drum_loop_.sample_rate = sample_rate;

        // Reset playback state
        playback_position_ = 0;
        current_slice_idx_ = 0;
        slice_start_position_ = 0;
        slice_end_position_ = length_samples;
        crossfading_ = false;
        loop_active_ = true;

        critical_section_exit(&cs_);

        // Regenerate slices with current parameters
        GenerateSlicePoints();
    }

    void ProcessParams(const std::vector<float>& params) {
        if (params.size() != kN_Params) return;

        slice_probability_ = params[0];
        clustering_factor_ = params[1];
        phrase_awareness_ = params[2];
        grid_tightness_ = params[3];

        // Regenerate slice points with new parameters
        GenerateSlicePoints();
    }

    // Real-time audio processing function - called from DMA interrupt
    float Process() {
        if (!loop_active_ || drum_loop_.samples == nullptr || drum_loop_.length_samples == 0) {
            return 0.0f;
        }

        // Update playback state if parameters changed
        UpdatePlaybackState();

        float output_sample = 0.0f;

        // Handle crossfading between slices
        if (crossfading_) {
            // Get current sample and previous slice sample for crossfade
            float current_sample = (playback_position_ < drum_loop_.length_samples) ?
                drum_loop_.samples[playback_position_] : 0.0f;

            float fade_ratio = float(crossfade_position_) / float(kCrossfadeSamples);

            // Simple linear crossfade
            output_sample = crossfade_buffer_[crossfade_position_] * (1.0f - fade_ratio) +
                           current_sample * fade_ratio;

            crossfade_position_++;
            if (crossfade_position_ >= kCrossfadeSamples) {
                crossfading_ = false;
                crossfade_position_ = 0;
            }
        } else {
            // Normal playback
            output_sample = (playback_position_ < drum_loop_.length_samples) ?
                drum_loop_.samples[playback_position_] : 0.0f;
        }

        // Advance playback position
        playback_position_++;

        // Check if we've reached the end of current slice
        if (playback_position_ >= slice_end_position_) {
            // Find next slice
            bool found_next_slice = false;

            // First, try to find a slice that starts at or after current position
            for (int i = 0; i < active_num_slices_; ++i) {
                if ((*active_slices_)[i].active &&
                    (*active_slices_)[i].start_sample >= playback_position_) {

                    // Prepare crossfade buffer with current slice end
                    for (int j = 0; j < kCrossfadeSamples && j < slice_end_position_ - slice_start_position_; ++j) {
                        uint32_t pos = slice_end_position_ - kCrossfadeSamples + j;
                        crossfade_buffer_[j] = (pos < drum_loop_.length_samples) ?
                            drum_loop_.samples[pos] : 0.0f;
                    }

                    // Jump to new slice
                    current_slice_idx_ = i;
                    slice_start_position_ = (*active_slices_)[i].start_sample;
                    slice_end_position_ = slice_start_position_ + (*active_slices_)[i].length_samples;
                    playback_position_ = slice_start_position_;

                    crossfading_ = true;
                    crossfade_position_ = 0;
                    found_next_slice = true;
                    break;
                }
            }

            // If no slice found ahead, loop back to beginning
            if (!found_next_slice) {
                // Prepare crossfade buffer
                for (int j = 0; j < kCrossfadeSamples; ++j) {
                    uint32_t pos = slice_end_position_ - kCrossfadeSamples + j;
                    crossfade_buffer_[j] = (pos < drum_loop_.length_samples) ?
                        drum_loop_.samples[pos] : 0.0f;
                }

                // Go to first slice
                current_slice_idx_ = 0;
                if (active_num_slices_ > 0 && (*active_slices_)[0].active) {
                    slice_start_position_ = (*active_slices_)[0].start_sample;
                    slice_end_position_ = slice_start_position_ + (*active_slices_)[0].length_samples;
                } else {
                    slice_start_position_ = 0;
                    slice_end_position_ = drum_loop_.length_samples;
                }

                playback_position_ = slice_start_position_;
                crossfading_ = true;
                crossfade_position_ = 0;
            }
        }

        return output_sample;
    }

    // Get current slice configuration (thread-safe)
    const SlicePoint* GetSlicePoints() const {
        return active_slices_->data();
    }

    int GetNumActiveSlices() const {
        return active_num_slices_;
    }

    // Get current playback info (for debugging/visualization)
    uint32_t GetPlaybackPosition() const {
        return playback_position_;
    }

    int GetCurrentSliceIndex() const {
        return current_slice_idx_;
    }

    // Get slice at specific position (for external playback systems)
    const SlicePoint* GetSliceAtPosition(uint32_t sample_position) const {
        for (int i = 0; i < active_num_slices_; ++i) {
            if ((*active_slices_)[i].active &&
                sample_position >= (*active_slices_)[i].start_sample &&
                sample_position < (*active_slices_)[i].start_sample + (*active_slices_)[i].length_samples) {
                return &(*active_slices_)[i];
            }
        }
        return nullptr;
    }

    // Debug info (thread-safe)
    void PrintSliceInfo() const {
        critical_section_enter_blocking(const_cast<critical_section_t*>(&cs_));

        // Only implement if you have debug output capability
        // for (int i = 0; i < active_num_slices_; ++i) {
        //     printf("Slice %d: start=%u, length=%u, prob=%.2f\n",
        //            i, (*active_slices_)[i].start_sample,
        //            (*active_slices_)[i].length_samples,
        //            (*active_slices_)[i].probability);
        // }
        // printf("Playback: pos=%u, slice=%d, crossfade=%d\n",
        //        playback_position_, current_slice_idx_, crossfading_);

        critical_section_exit(const_cast<critical_section_t*>(&cs_));
    }
};
