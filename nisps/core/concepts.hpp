// nisps/core/concepts.hpp — C++20 concepts that pin down the shape of the
// three central types in the rewrite: ML engines, audio engines and modes.
//
// These are CONCEPTS, not interfaces — there is no virtual dispatch in the
// hot paths. Concrete types are templated/satisfied at compile time on
// firmware; the WASM bindings layer flattens to a C API for the browser.
//
// See architecture.md §4.1, §4.2, §4.3.

#pragma once

#include <concepts>
#include <cstddef>
#include <cstdint>
#include <span>
#include <string_view>

#include "types.hpp"

namespace nisps {

// Forward declaration. Concrete `ParamSchema` lives with the codegen output
// (stream 5). Modes only need to expose a constexpr reference to it.
struct ParamSchema;

// ---------------------------------------------------------------------------
// MLEngine — interactive ML inference + training + RL state perturbation.
// Implementations: nisps::MLP<NIn, NHidden..., NOut> in stream 2.
// ---------------------------------------------------------------------------
template <typename T>
concept MLEngine = requires(T e,
                            std::span<const float> in,
                            std::span<float>       out,
                            std::size_t            idx,
                            float                  fv,
                            std::uint64_t          seed) {
    { e.set_input(idx, fv) }    -> std::same_as<void>;
    { e.process() }             -> std::same_as<void>;
    { e.outputs() }             -> std::same_as<std::span<const float>>;
    { e.add_example(in, in) }   -> std::same_as<void>;
    { e.train() }               -> std::same_as<float>;   // returns final loss
    { e.move_weights(fv, fv) }  -> std::same_as<void>;    // (speed, spread)
    { e.draw_weights(fv) }      -> std::same_as<void>;    // (spread)
    { e.reset() }               -> std::same_as<void>;
    { e.seed(seed) }            -> std::same_as<void>;
};

// ---------------------------------------------------------------------------
// AudioEngine — per-sample stereo processor. Sample-rate is negotiated at
// setup; engines should NOT assume 48 kHz.
// ---------------------------------------------------------------------------
template <typename T>
concept AudioEngine = requires(T e,
                               stereosample_t          s,
                               std::span<const float>  params,
                               float                   sr) {
    { T::param_count() } -> std::convertible_to<std::size_t>;        // constexpr
    { T::engine_id() }   -> std::same_as<std::string_view>;          // constexpr
    { e.setup(sr) }      -> std::same_as<void>;
    { e.set_params(params) } -> std::same_as<void>;                  // non-RT
    { e.process(s) }     -> std::same_as<stereosample_t>;            // RT, per-sample
    { e.driver_config() } -> std::convertible_to<DriverConfig>;
};

// ---------------------------------------------------------------------------
// Mode — binds an ML config + audio engine + voice space + I/O channel
// mapping. Hardware bindings live OUTSIDE this concept (firmware/glue,
// playground/src/modes); modes are platform-agnostic.
// ---------------------------------------------------------------------------
template <typename T>
concept Mode = requires(T m, std::size_t idx, float v, stereosample_t s, float sr) {
    { T::mode_id() }              -> std::same_as<std::string_view>;          // constexpr
    { T::input_channel_count() }  -> std::convertible_to<std::size_t>;        // constexpr
    { T::param_schema() }         -> std::same_as<const ParamSchema&>;        // constexpr ref
    { m.setup(sr) }               -> std::same_as<void>;
    { m.set_input(idx, v) }       -> std::same_as<void>;
    { m.tick_control() }          -> std::same_as<void>;                       // non-RT
    { m.process(s) }              -> std::same_as<stereosample_t>;             // RT
    // engine() / ml() return references; we only assert they are callable.
    // (`auto&` in concept signatures is awkward; require non-void.)
    { m.engine() };
    { m.ml() };
};

}  // namespace nisps
