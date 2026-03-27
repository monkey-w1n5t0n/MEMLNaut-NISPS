RACK_DIR ?= $(HOME)/.local/share/Rack2/Rack-SDK

FLAGS += -std=c++20
FLAGS += -I$(RACK_DIR)/include -I$(RACK_DIR)/dep/include
FLAGS += -I../nisps-core/include

SOURCES += src/plugin.cpp
SOURCES += src/MEMLNaut.cpp

DISTRIBUTABLES += res

include $(RACK_DIR)/plugin.mk

# Remove SDK's default c++11 to avoid conflicting flags
CXXFLAGS := $(filter-out -std=c++11,$(CXXFLAGS))
