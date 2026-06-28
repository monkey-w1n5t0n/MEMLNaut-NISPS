RACK_DIR ?= $(HOME)/.local/share/Rack2/Rack-SDK

FLAGS += -std=c++20
FLAGS += -I$(RACK_DIR)/include -I$(RACK_DIR)/dep/include
# The retired nisps-core header tree is gone; the runtime IML/MLP is vendored
# self-contained in src/iml.hpp (see that file's header for the rationale).
FLAGS += -Isrc

SOURCES += src/plugin.cpp
SOURCES += src/MEMLNaut.cpp

DISTRIBUTABLES += res

include $(RACK_DIR)/plugin.mk

# Remove SDK's default c++11 to avoid conflicting flags
CXXFLAGS := $(filter-out -std=c++11,$(CXXFLAGS))
