#include "SerialUSBOutput.hpp"

SerialUSBOutput::SerialUSBOutput()
{
    //assume Serial has already begun()

}

void SerialUSBOutput::SendFloatArray(const std::vector<float> &params)
{
    Serial.write(SLIP_END);
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
    Serial.write(SLIP_END);
}

void SerialUSBOutput::slipSendByte(uint8_t b)
{
    if(b == SLIP_END)
    {
        Serial.write(SLIP_ESC);
        Serial.write(SLIP_ESC_END);
    }
    else if(b == SLIP_ESC)
    {
        Serial.write(SLIP_ESC);
        Serial.write(SLIP_ESC_ESC);
    }
    else
    {
        Serial.write(b);
    }
}
