#ifndef __FORMAT_HPP__
#define __FORMAT_HPP__


#include <Arduino.h>
#include <string.h>
#include <math.h>

template<typename T>
void formatNumber(char* buf, T value) {
    if constexpr(std::is_floating_point_v<T>) {
        if (isnan(value)) {
            strcpy(buf, " NaN ");
            return;
        }
        if (isinf(value)) {
            strcpy(buf, " Inf ");
            return;
        }

        float absVal = fabs(value);
        if (absVal < 1e-10) {
            strcpy(buf, "  0  ");
            return;
        }
        if (absVal >= 1e10) {
            strcpy(buf, " OVER");
            return;
        }

        char tempBuf[16];
        if (absVal >= 0.001f && absVal < 10.0f) {
            dtostrf(value, 5, 3, tempBuf);
        } else if (absVal >= 10.0f && absVal < 100.0f) {
            dtostrf(value, 5, 2, tempBuf);
        } else if (absVal >= 100.0f && absVal < 1000.0f) {
            dtostrf(value, 5, 1, tempBuf);
        } else {
            // Handle scientific notation manually with controlled width
            int exponent = floor(log10(absVal));
            float mantissa = value / pow(10, exponent);
            if (value < 0) mantissa = -mantissa;

            // Ensure mantissa is in range [-9.9, 9.9]
            while (abs(mantissa) >= 10.0f) {
                mantissa /= 10.0f;
                exponent += 1;
            }

            // Validate exponent range
            if (exponent > 9 || exponent < -9) {
                strcpy(buf, " OVER");
                return;
            }

            // Format scientific notation without snprintf
            bool negative = mantissa < 0;
            mantissa = abs(mantissa);

            // Format mantissa as single digit
            int digit = round(mantissa);
            if (digit == 10) {
                digit = 1;
                exponent += 1;
            }

            // Validate exponent range again after adjustment
            if (exponent > 9 || exponent < -9) {
                strcpy(buf, " OVER");
                return;
            }

            // Build string manually: [-]#e±#
            buf[0] = negative ? '-' : ' ';
            buf[1] = '0' + digit;
            buf[2] = 'e';
            buf[3] = (exponent < 0) ? '-' : '+';
            buf[4] = '0' + abs(exponent);
            buf[5] = '\0';
            return;
        }
        strncpy(buf, tempBuf, 5);
        buf[5] = '\0';

    } else {
        if constexpr(std::is_unsigned_v<T>) {
            if (value < 10000) {  // Changed from 1000
                // Format small unsigned integers directly
                if (value < 10) {
                    // Single digit centered
                    buf[0] = buf[1] = ' ';
                    buf[2] = '0' + value;
                    buf[3] = buf[4] = ' ';
                } else {
                    // Two to four digits right-justified
                    char tmp[5];  // Increased buffer size
                    utoa(value, tmp, 10);
                    size_t len = strlen(tmp);
                    memset(buf, ' ', 5);
                    memcpy(buf + (5 - len), tmp, len);  // Changed from 4 to 5
                }
                buf[5] = '\0';
            } else {
                // Handle large unsigned integers with scientific notation
                float fVal = static_cast<float>(value);
                int exponent = floor(log10(fVal));
                float mantissa = fVal / pow(10, exponent);
                if (exponent > 9) {
                    strcpy(buf, " OVER");
                } else {
                    int whole = round(mantissa);
                    buf[0] = ' ';
                    buf[1] = '0' + whole;
                    buf[2] = 'e';
                    buf[3] = '+';
                    buf[4] = '0' + exponent;
                    buf[5] = '\0';
                }
            }
        } else {  // signed integers
            if (std::abs(static_cast<long long>(value)) < 10000) {  // Changed from 1000
                // Format small signed integers directly
                if (std::abs(static_cast<long long>(value)) < 10) {
                    // Single digit with possible sign
                    buf[0] = buf[1] = ' ';
                    if (value < 0) {
                        buf[1] = '-';
                        buf[2] = '0' - value;
                    } else {
                        buf[2] = '0' + value;
                    }
                    buf[3] = buf[4] = ' ';
                } else {
                    // Two to four digits with possible sign
                    char tmp[6];  // Increased buffer size for sign
                    itoa(value, tmp, 10);
                    size_t len = strlen(tmp);
                    memset(buf, ' ', 5);
                    memcpy(buf + (5 - len), tmp, len);
                }
                buf[5] = '\0';
            } else {
                float fVal = static_cast<float>(value);
                int exponent = floor(log10(std::abs(fVal)));
                float mantissa = fVal / pow(10, exponent);
                if (exponent > 9) {
                    strcpy(buf, " OVER");
                } else {
                    int whole = round(mantissa);
                    buf[0] = (value < 0) ? '-' : ' ';
                    buf[1] = '0' + std::abs(whole);
                    buf[2] = 'e';
                    buf[3] = '+';
                    buf[4] = '0' + exponent;
                    buf[5] = '\0';
                }
            }
        }
    }

    // Right padding for short results
    size_t len = strlen(buf);
    if (len < 5) {
        memmove(buf + (5-len), buf, len);
        memset(buf, ' ', 5-len);
    }
    buf[5] = '\0';
}


#endif // __FORMAT_HPP__
