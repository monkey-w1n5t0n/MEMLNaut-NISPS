// nisps/core/fixed_buffer.hpp — heap-free dynamic-length array with
// compile-time capacity. Replaces std::vector in hot paths.
//
// API mirrors a tiny subset of std::vector: push_back / clear / size / data /
// operator[] / iterators / front / back. NO reserve, NO resize-with-default,
// NO insert. If you need those, you're probably reaching for the wrong tool.
//
// Bounds checking: push_back returns bool (false ⇒ full, no-op). operator[]
// is unchecked — match std::vector's behavior.

#pragma once

#include <array>
#include <cstddef>
#include <type_traits>
#include <utility>

namespace nisps {

template <typename T, std::size_t N>
class FixedBuffer {
   public:
    using value_type      = T;
    using size_type       = std::size_t;
    using iterator        = T*;
    using const_iterator  = const T*;

    constexpr FixedBuffer() noexcept = default;

    // Trivially copyable when T is. Move/copy semantics fine — backing store
    // is std::array, which has correct value-semantics.

    constexpr size_type size()      const noexcept { return n_; }
    static constexpr size_type capacity() noexcept { return N; }
    constexpr bool      empty()     const noexcept { return n_ == 0u; }
    constexpr bool      full()      const noexcept { return n_ == N; }

    constexpr T*       data()       noexcept { return buf_.data(); }
    constexpr const T* data() const noexcept { return buf_.data(); }

    constexpr T&       operator[](size_type i)       noexcept { return buf_[i]; }
    constexpr const T& operator[](size_type i) const noexcept { return buf_[i]; }

    constexpr T&       front()       noexcept { return buf_[0]; }
    constexpr const T& front() const noexcept { return buf_[0]; }
    constexpr T&       back()        noexcept { return buf_[n_ - 1u]; }
    constexpr const T& back()  const noexcept { return buf_[n_ - 1u]; }

    constexpr iterator       begin()       noexcept { return buf_.data(); }
    constexpr const_iterator begin() const noexcept { return buf_.data(); }
    constexpr iterator       end()         noexcept { return buf_.data() + n_; }
    constexpr const_iterator end()   const noexcept { return buf_.data() + n_; }

    constexpr void clear() noexcept { n_ = 0u; }

    // Returns true on success. Does NOT throw or assert when full — callers
    // are expected to size the buffer correctly.
    constexpr bool push_back(const T& v) noexcept(std::is_nothrow_copy_assignable_v<T>) {
        if (n_ >= N) return false;
        buf_[n_++] = v;
        return true;
    }
    constexpr bool push_back(T&& v) noexcept(std::is_nothrow_move_assignable_v<T>) {
        if (n_ >= N) return false;
        buf_[n_++] = std::move(v);
        return true;
    }

    // pop_back — trivial decrement; does not destroy (T must be cleanup-free).
    constexpr void pop_back() noexcept { if (n_ > 0u) --n_; }

   private:
    std::array<T, N> buf_{};
    size_type        n_ = 0u;
};

}  // namespace nisps
