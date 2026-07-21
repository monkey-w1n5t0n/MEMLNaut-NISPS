#ifndef __ANALYSIS_PARAMS_HPP__
#define __ANALYSIS_PARAMS_HPP__

#include <stddef.h>
#include <vector>


void AnalysisParamsSetup(size_t n_params);
void AnalysisParamsWrite(std::vector<float> &params);
void AnalysisParamsRead(std::vector<float> &params);

#endif  // __ANALYSIS_PARAMS_HPP__
