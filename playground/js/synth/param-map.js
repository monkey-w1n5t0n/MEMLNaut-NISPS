// Maps 20 NISPS outputs (0-1) to curated C15 synth parameters
// Each entry: { id, name, label, defaultValue, bipolar }
// Chosen for maximum sonic impact and exploration potential

export const SYNTH_PARAM_MAP = [
  { id: 60,  name: 'Osc_A_PM_Self',     label: 'OscA Self-PM',  defaultValue: 0.00, bipolar: true },
  { id: 64,  name: 'Osc_A_PM_B',        label: 'OscA PM-B',     defaultValue: 0.00, bipolar: true },
  { id: 90,  name: 'Osc_B_PM_Self',     label: 'OscB Self-PM',  defaultValue: 0.00, bipolar: true },
  { id: 94,  name: 'Osc_B_PM_A',        label: 'OscB PM-A',     defaultValue: 0.00, bipolar: true },
  { id: 71,  name: 'Shp_A_Drive',       label: 'ShpA Drive',    defaultValue: 0.20, bipolar: false },
  { id: 74,  name: 'Shp_A_Fold',        label: 'ShpA Fold',     defaultValue: 0.50, bipolar: false },
  { id: 101, name: 'Shp_B_Drive',       label: 'ShpB Drive',    defaultValue: 0.20, bipolar: false },
  { id: 140, name: 'SV_Flt_Cut',        label: 'SVF Cutoff',    defaultValue: 0.50, bipolar: false },
  { id: 144, name: 'SV_Flt_Res',        label: 'SVF Reso',      defaultValue: 0.50, bipolar: false },
  { id: 148, name: 'SV_Flt_Spread',     label: 'SVF Spread',    defaultValue: 0.20, bipolar: true },
  { id: 115, name: 'Comb_Flt_Pitch',    label: 'Comb Pitch',    defaultValue: 0.50, bipolar: false },
  { id: 119, name: 'Comb_Flt_Decay',    label: 'Comb Decay',    defaultValue: 0.00, bipolar: true },
  { id: 127, name: 'Comb_Flt_AP_Res',   label: 'Comb AP Res',   defaultValue: 0.50, bipolar: false },
  { id: 235, name: 'Reverb_Size',       label: 'Reverb Size',   defaultValue: 0.33, bipolar: false },
  { id: 238, name: 'Reverb_Color',      label: 'Reverb Color',  defaultValue: 0.50, bipolar: false },
  { id: 225, name: 'Echo_Time',         label: 'Echo Time',     defaultValue: 0.43, bipolar: false },
  { id: 229, name: 'Echo_Feedback',     label: 'Echo FB',       defaultValue: 0.50, bipolar: false },
  { id: 219, name: 'Flanger_Feedback',  label: 'Flanger FB',    defaultValue: 0.00, bipolar: true },
  { id: 169, name: 'Out_Mix_A_Lvl',     label: 'Out A Level',   defaultValue: 0.75, bipolar: true },
  { id: 172, name: 'Out_Mix_B_Lvl',     label: 'Out B Level',   defaultValue: 0.00, bipolar: true },
];

// Parameter display names for the param bar UI
export const SYNTH_PARAM_NAMES = SYNTH_PARAM_MAP.map(p => p.label);

// Colors for synth mode param bars (warm/synth palette)
export const SYNTH_PARAM_COLORS = [
  '#ff6b35', '#ff9a3c', '#e85d04', '#ffb703',
  '#fb5607', '#ff006e', '#8338ec', '#3a86ff',
  '#06d6a0', '#118ab2', '#073b4c', '#ef476f',
  '#ffd166', '#06d6a0', '#118ab2', '#8ecae6',
  '#219ebc', '#ffb4a2', '#e5989b', '#b5838d',
];
