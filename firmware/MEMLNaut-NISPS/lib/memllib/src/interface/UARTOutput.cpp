#include "UARTOutput.hpp"

UARTOutput::UARTOutput(int txPin)
    : pioSerial_(txPin, NOPIN) // TX only, no RX pin
{
    // Start the PIO-based serial port at 115200 baud
    pioSerial_.begin(115200);
}

void UARTOutput::SendParams(const std::vector<float> &params)
{
    // Encode each float (4 bytes) via SLIP
    for(const auto& f : params)
    {
        union {
            float   f;
            uint8_t b[4];
        } data;
        data.f = f;

        for(int i = 0; i < 4; i++)
        {
            slipSendByte(data.b[i]);
        }
    }

    // Finally, write the SLIP_END marker
    pioSerial_.write(SLIP_END);
}

void UARTOutput::slipSendByte(uint8_t b)
{
    if(b == SLIP_END)
    {
        pioSerial_.write(SLIP_ESC);
        pioSerial_.write(SLIP_ESC_END);
    }
    else if(b == SLIP_ESC)
    {
        pioSerial_.write(SLIP_ESC);
        pioSerial_.write(SLIP_ESC_ESC);
    }
    else
    {
        pioSerial_.write(b);
    }
}
