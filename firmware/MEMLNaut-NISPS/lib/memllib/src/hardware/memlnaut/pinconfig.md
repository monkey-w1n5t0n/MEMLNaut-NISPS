# Pin configuration

## Momentary switches or buttons:

| Pin Number | Pin Name | Type |
|------------|----------|------|
| 24 | MOM_A1 | INPUT_PULLUP |
| 25 | MOM_A2 | INPUT_PULLUP |
| 28 | MOM_B1 | INPUT_PULLUP |
| 29 | MOM_B2 | INPUT_PULLUP |
| 23 | RE_SW | INPUT_PULLUP |
| 17 | RE_B | INPUT_PULLUP |
| 11 | RE_A | INPUT_PULLUP |

## Toggle switches:
| Pin Number | Pin Name | Type |
|------------|----------|------|
| 26 | TOG_A1 | INPUT_PULLUP |
| 27 | TOG_A2 | INPUT_PULLUP |
| 30 | TOG_B1 | INPUT_PULLUP |
| 31 | TOG_B2 | INPUT_PULLUP |
| 32 | JOY_SW | INPUT_PULLUP |

## ADCs:

| Pin Number | Pin Name | ADC Channel | Type | Resolution |
|------------|----------|-------------|------|------------|
| 40 | JOY_X | 0 | INPUT | 12-bit |
| 41 | JOY_Y | 1 | INPUT | 12-bit |
| 42 | JOY_Z | 2 | INPUT | 12-bit |
| 47 | RV_Gain1 | 7 | INPUT | 12-bit |
| 46 | RV_Z1 | 6 | INPUT | 12-bit |
| 45 | RV_Y1 | 5 | INPUT | 12-bit |
| 44 | RV_X1 | 4 | INPUT | 12-bit |

## LED:

| Pin Number | Pin Name | Type | Description |
|------------|----------|------|-------------|
| 33 | LED | OUTPUT | Status LED |
| 43 | LED_Timing | OUTPUT | Timing LED |

## UART:

| UART Name | TX Pin | RX Pin | Description |
|-----------|--------|--------|-------------|
| DaisyPIO | 36 | N/A | One-way communication to Daisy |
| SensorUART | 34 | 35 | Bidirectional sensor communication |
| MIDI | 4 | 5 | MIDI in/out |

## SPI:

| SPI Name | CS Pin | SCK Pin | MISO Pin | MOSI Pin | Description |
|----------|--------|---------|----------|----------|-------------|
| SDCard | 13 | 14 | 12 | 15 | SPI interface to onboard SD card |

## I2C:

| I2C Name | SDA Pin | SCL Pin | Description |
|----------|---------|---------|-------------|
| USeqI2C | 38 | 39 | USeq output for CV |
