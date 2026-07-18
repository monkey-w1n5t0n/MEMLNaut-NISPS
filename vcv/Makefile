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
# src/iml.hpp is a THIN adapter over the shared C++ core: it pulls in
# nisps/ml/{mlp,dynamic_storage}.hpp + nisps/core/rng.hpp via relative includes
# (../../nisps/…), so no extra -I for the core is needed here (P6, 2026-07-18).
FLAGS += -Isrc

SOURCES += src/plugin.cpp
SOURCES += src/MEMLNaut.cpp

DISTRIBUTABLES += res

include $(RACK_DIR)/plugin.mk

# Remove SDK's default c++11 to avoid conflicting flags
CXXFLAGS := $(filter-out -std=c++11,$(CXXFLAGS))
