RACK_DIR ?= $(HOME)/.local/share/Rack2/Rack-SDK

# Detect the target arch early (defines ARCH_WIN/ARCH_LIN/ARCH_MAC) so we can add
# per-platform link libs before plugin.mk wires the link rule. The OSC bridge
# server (src/osc_server.hpp) uses Winsock2 on Windows; mingw ignores the
# MSVC-only `#pragma comment(lib, "ws2_32.lib")`, so link it explicitly.
include $(RACK_DIR)/arch.mk
ifdef ARCH_WIN
LDFLAGS += -lws2_32
endif

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
