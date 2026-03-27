#include "plugin.hpp"

Plugin* pluginInstance;

extern Model* modelMEMLNaut;

void init(Plugin* p) {
    pluginInstance = p;

    p->addModel(modelMEMLNaut);
}
