#ifndef MAXIPAF_HPP
#define MAXIPAF_HPP

#include "maximilian.h"

constexpr size_t LOGTABSIZE  = 10;
constexpr size_t LOGTABSIZEINV  = 32 - LOGTABSIZE;
constexpr size_t TABSIZE = (1 << LOGTABSIZE);
constexpr size_t TABRANGE = 3;



typedef struct _tabpoint
{
    float p_y;
    float p_diff;
} t_tabpoint;


typedef struct _linenv
{
    double l_current;
    double l_biginc;
    float l_1overn;
    float l_target;
    float l_msectodsptick;
    int l_ticks;
} t_linenv;


constexpr size_t UNITBIT32 = 1572864.f;		/* 3*2^19 -- bit 32 has value 1 */
constexpr float TABFRACSHIFT = (UNITBIT32/TABSIZE);


//little endian
#define HIOFFSET 1
#define LOWOFFSET 0

#include <sys/types.h>
#define int32 u_int32_t


#define LINENV_RUN(linenv, current, incr) 		\
    if (linenv.l_ticks > 0)				\
    {							\
    	current = linenv.l_current;			\
    	incr = linenv.l_biginc * linenv.l_1overn;	\
	linenv.l_ticks--;				\
	linenv.l_current += linenv.l_biginc;		\
    }							\
    else						\
    {							\
    	linenv.l_current = current = linenv.l_target;	\
	incr = 0;					\
    }


constexpr float PAFA1 = 4 * (3.14159265/2);
constexpr float PAFA3 = ((64 * (2.5 - 3.14159265)));
constexpr float PAFA5 ((1024 * ((3.14159265/2) - 1.5)));
    /* value of Cauchy distribution at TABRANGE */
constexpr float CAUCHYVAL = (1./ (1. + TABRANGE * TABRANGE));
    /* first derivative of Cauchy distribution at TABRANGE */
constexpr float CAUCHYSLOPE = ((-2. * TABRANGE) * CAUCHYVAL * CAUCHYVAL);
constexpr float ADDSQ = (- CAUCHYSLOPE / (2 * TABRANGE));
constexpr float HALFSINELIM  = (0.997 * TABRANGE);
constexpr float TABRANGERCPR = 1.f/TABRANGE;

static t_tabpoint __not_in_flash("paf") paf_gauss[TABSIZE];
static t_tabpoint __not_in_flash("paf") paf_cauchy[TABSIZE];
static bool tabsGenerated = false;


class maxiPAFOperator {
public:


    void linenv_init(t_linenv &l)
    {
        l.l_current = l.l_biginc = 0;
        l.l_1overn = l.l_target = l.l_msectodsptick = 0;
        l.l_ticks = 0;
    }


    void init()
    {
        int i;
            if (!tabsGenerated) {
            const float CAUCHYFAKEAT3  =
                (CAUCHYVAL + ADDSQ * TABRANGE * TABRANGE);
            const float CAUCHYRESIZE = (1./ (1. - CAUCHYFAKEAT3));
            for (i = 0; i <= TABSIZE; i++)
            {
                float f = i * ((float)TABRANGE/(float)TABSIZE);
                float gauss = expf(-f * f);
                float cauchygenuine = 1.f / (1.f + f * f);
                float cauchyfake = cauchygenuine + ADDSQ * f * f;
                float cauchyrenorm = (cauchyfake - 1.) * CAUCHYRESIZE + 1.;
                if (i != TABSIZE)
                {
                    paf_gauss[i].p_y = gauss;
                    paf_cauchy[i].p_y = cauchyrenorm;
                    /* post("%f", cauchyrenorm); */
                }
                if (i != 0)
                {
                    paf_gauss[i-1].p_diff = gauss - paf_gauss[i-1].p_y;
                    paf_cauchy[i-1].p_diff = cauchyrenorm - paf_cauchy[i-1].p_y;
                }
            }
        }
        // linenv_init(x_freqenv);
        // linenv_init(x_cfenv);
        // linenv_init(x_bwenv);
        // linenv_init(x_ampenv);
        // linenv_init(x_vibenv);
        // linenv_init(x_vfrenv);
        // linenv_init(x_shiftenv);
        // x_freqenv.l_target = x_freqenv.l_current = 1.0;
        //TODO: use correct sample rate
        x_isr = maxiSettings::one_over_sampleRate; //1.f/44100.f;
        x_held_freq = 1.f;
        x_held_intcar = 0.f;
        x_held_fraccar = 0.f;
        x_held_bwquotient = 0.f;
        x_phase = 0.;
        x_shiftphase = 0.;
        x_vibphase = 0.;
        x_triggerme = 0;
    }

    void linenv_setsr(t_linenv &l, const float sr, const int vecsize)
    {
        l.l_msectodsptick = sr / (1000.f * ((float)vecsize));
        l.l_1overn = 1.f/(float)vecsize;
    }

    void setsr(const float sr, const int vecsize)
    {
        x_isr = 1.f/sr;
        // linenv_setsr(x_freqenv, sr, vecsize);
        // linenv_setsr(x_cfenv, sr, vecsize);
        // linenv_setsr(x_bwenv, sr, vecsize);
        // linenv_setsr(x_ampenv, sr, vecsize);
        // linenv_setsr(x_vibenv, sr, vecsize);
        // linenv_setsr(x_vfrenv, sr, vecsize);
        // linenv_setsr(x_shiftenv, sr, vecsize);
    }

    inline void linenv_set(t_linenv &l, const float target, const long timdel)
    {
        if (timdel > 0)
        {
            l.l_ticks = ((float)timdel) * l.l_msectodsptick;
            if (!l.l_ticks) l.l_ticks = 1;
            l.l_target = target;
            l.l_biginc = (l.l_target - l.l_current)/l.l_ticks;
        }
        else
        {
            l.l_ticks = 0;
            l.l_current = l.l_target = target;
            l.l_biginc = 0;
        }
    }


    inline void phase(const float mainphase, const float shiftphase,
        const float vibphase)
    {
        x_phase = mainphase;
        x_shiftphase = shiftphase;
        x_vibphase = vibphase;
        x_triggerme = 1;
    }

    void __force_inline play(float *out1, int n, float freqval, const float cfval, const float bwval,
        const float vibval,
        const float vfrval,
        float shiftval,
        const bool x_cauchy=false)
    {
        float bwquotient, bwqincr;

        // float held_freq = x_held_freq;
        float held_intcar = x_held_intcar;
        float held_fraccar = x_held_fraccar;
        float held_bwquotient = x_held_bwquotient;
        float sinvib, vibphase;

        t_tabpoint *paf_table = (x_cauchy ? paf_cauchy : paf_gauss);

        x_shiftphase -= floorf(x_shiftphase);

        /* fake line envelope for quotient of bw and frequency */
        bwquotient = bwval/freqval;

        float future_vib_phase = x_vibphase + n * x_isr * vfrval;
        future_vib_phase = future_vib_phase - floorf(future_vib_phase);
        x_vibphase = vibphase = future_vib_phase;        

        if (vibphase > 0.5f)
            sinvib = 1.0f - 16.0f * (0.75f-vibphase) * (0.75f - vibphase);
        else sinvib = -1.0f + 16.0f * (0.25f-vibphase) * (0.25f - vibphase);

        freqval = freqval * (1.0f + vibval * sinvib);
        
        const float inv_freqval = 1.0f / freqval;

        shiftval *= x_isr;

        if (x_phase ==0.f || x_triggerme)
        {
            float cf_over_freq = cfval * inv_freqval;
            x_held_freq = freqval * x_isr;
            held_intcar = (float)((int)cf_over_freq);
            held_fraccar = cf_over_freq - held_intcar;
            held_bwquotient = bwquotient;
            x_triggerme = 0;
        }
        while (n--)
        {
            float g,halfsine;            

            float new_x_phase = x_phase + x_held_freq;
            new_x_phase = new_x_phase - floorf(new_x_phase);
            float fracnewphase = new_x_phase;

            const float fphase = 2.0f * ((fracnewphase)) - 1.0f;
            if (new_x_phase < x_phase) [[unlikely]] 
            {
                float cf_over_freq = cfval * inv_freqval;
                x_held_freq = freqval * x_isr;
                held_intcar = floorf(cf_over_freq);
                held_fraccar = cf_over_freq - held_intcar;
                held_bwquotient = bwquotient;
            }

            x_phase = new_x_phase;

            float fcarphase1 = fracnewphase * held_intcar + x_shiftphase;
            fcarphase1 -= floorf(fcarphase1);

            float fcarphase2 = fcarphase1 + fracnewphase;
            fcarphase2 -= floorf(fcarphase2);

            x_shiftphase += shiftval;

            g = (fcarphase1 > 0.5f) ? (fcarphase1 - 0.75f) : (0.25f - fcarphase1);

            const float g2a = g * g;
            const float g3a = g * g2a;
            const float cosine1 = g * PAFA1 + g3a * PAFA3 + g2a * g3a * PAFA5;

            g = (fcarphase2 > 0.5f) ? (fcarphase2 - 0.75f) : (0.25f - fcarphase2);
            const float g2b = g * g;
            const float g3b = g * g2b;
            const float cosine2 = g * PAFA1 + g3b * PAFA3 + g2b * g3b * PAFA5;

            const float carrier = cosine1 + held_fraccar * (cosine2-cosine1);

            halfsine = held_bwquotient * (1.0f - fphase * fphase);

            halfsine = fminf(halfsine, HALFSINELIM);

            constexpr float TABSCALE = (TABSIZE * TABRANGERCPR);

            float halfsineScaled = halfsine * TABSCALE;

            // Extract integer and fractional parts
            int table_index = static_cast<int>(halfsineScaled);
            const float tabfrac = (halfsineScaled) - table_index;

            // Bounds check
            table_index = min(TABSIZE-2, table_index);
            table_index = max(0, table_index);

            // Linear interpolation
            const t_tabpoint *p = paf_table + table_index;
            const float mod = carrier * (p->p_y + tabfrac * p->p_diff);

            *out1++ = mod;
        }
        // x_held_freq = held_freq;
        x_held_intcar = held_intcar;
        x_held_fraccar = held_fraccar;
        x_held_bwquotient = held_bwquotient;
    }



private:


    float x_isr;
    float x_held_freq;
    float x_held_intcar;
    float x_held_fraccar;
    float x_held_bwquotient;
    float x_phase;
    float x_shiftphase;
    float x_vibphase;
    int x_triggerme;

};


#endif // MAXIPAF_HPP
