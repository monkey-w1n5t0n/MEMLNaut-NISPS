
/*
 *  maximilian.cpp
 *  platform independent synthesis library using portaudio or rtaudio
 *
 *  Created by Mick Grierson on 29/12/2009.
 *  Copyright 2009 Mick Grierson & Strangeloop Limited. All rights reserved.
 *	Thanks to the Goldsmiths Creative Computing Team.
 *	Special thanks to Arturo Castro for the PortAudio implementation.
 *
 *	Permission is hereby granted, free of charge, to any person
 *	obtaining a copy of this software and associated documentation
 *	files (the "Software"), to deal in the Software without
 *	restriction, including without limitation the rights to use,
 *	copy, modify, merge, publish, distribute, sublicense, and/or sell
 *	copies of the Software, and to permit persons to whom the
 *	Software is furnished to do so, subject to the following
 *	conditions:
 *
 *	The above copyright notice and this permission notice shall be
 *	included in all copies or substantial portions of the Software.
 *
 *	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 *	EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 *	OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 *	NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 *	HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 *	WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 *	FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 *	OTHER DEALINGS IN THE SOFTWARE.
 *
 */

#include "maximilian.h"
// #include "math.h"
// #include <iterator>
// extern "C" {
// #include <stdio.h>
// #include <string.h>
// }

#include <cstring>

//This used to be important for dealing with multichannel playback
float chandiv= 1;

maxiSettings::maxiSettings() {}

size_t maxiSettings::sampleRate = 48000;  // Match kSampleRate in AudioDriver.hpp
float maxiSettings::one_over_sampleRate = 1.f / 48000.f;
size_t maxiSettings::channels = 2;
size_t maxiSettings::bufferSize = 1024;


//this is a 514-point sinewave table that has many uses.

// This is a transition table that helps with bandlimited oscs.

//This is a lookup table for converting midi to frequency
float mtofarray[129]={0, 8.661957, 9.177024, 9.722718, 10.3, 10.913383, 11.562325, 12.25, 12.978271, 13.75, 14.567617, 15.433853, 16.351599, 17.323914, 18.354048, 19.445436, 20.601723, 21.826765, 23.124651, 24.5, 25.956543, 27.5, 29.135235, 30.867706, 32.703197, 34.647827, 36.708096, 38.890873, 41.203445, 43.65353, 46.249302, 49., 51.913086, 55., 58.27047, 61.735413, 65.406395, 69.295654, 73.416191, 77.781746, 82.406891, 87.30706, 92.498604, 97.998856, 103.826172, 110., 116.540939, 123.470825, 130.81279, 138.591309, 146.832382, 155.563492, 164.813782, 174.61412, 184.997208, 195.997711, 207.652344, 220., 233.081879, 246.94165, 261.62558, 277.182617,293.664764, 311.126984, 329.627563, 349.228241, 369.994415, 391.995422, 415.304688, 440., 466.163757, 493.883301, 523.25116, 554.365234, 587.329529, 622.253967, 659.255127, 698.456482, 739.988831, 783.990845, 830.609375, 880., 932.327515, 987.766602, 1046.502319, 1108.730469, 1174.659058, 1244.507935, 1318.510254, 1396.912964, 1479.977661, 1567.981689, 1661.21875, 1760., 1864.655029, 1975.533203, 2093.004639, 2217.460938, 2349.318115, 2489.015869, 2637.020508, 2793.825928, 2959.955322, 3135.963379, 3322.4375, 3520., 3729.31, 3951.066406, 4186.009277, 4434.921875, 4698.63623, 4978.031738, 5274.041016, 5587.651855, 5919.910645, 6271.926758, 6644.875, 7040., 7458.620117, 7902.132812, 8372.018555, 8869.84375, 9397.272461, 9956.063477, 10548.082031, 11175.303711, 11839.821289, 12543.853516, 13289.75};

void setup();//use this to do any initialisation if you want.

void play(float *channels);//run dac!

maxiOsc::maxiOsc(){
	//When you create an oscillator, the constructor sets the phase of the oscillator to 0.
	phase = 0.0;
	constant_by_one_over_sr_ = 512.f * maxiSettings::one_over_sampleRate;
}

void maxiOsc::UpdateParams(void)
{
	constant_by_one_over_sr_ = 512.f * maxiSettings::one_over_sampleRate;
}

float maxiOsc::noise() {
	//White Noise
	//always the same unless you seed it.
	float r = rand()/(float)RAND_MAX;
	output=r*2-1;
	return(output);
}

void maxiOsc::phaseReset(float phaseIn) {
	//This allows you to set the phase of the oscillator to anything you like.
	phase=phaseIn;

}

// float maxiOsc::sinewave(float frequency) {
// 	//This is a sinewave oscillator
// 	output=sinf (phase*(TWOPI));
// 	phase += maxiSettings::one_over_sampleRate * frequency;
// 	if ( phase >= 1.0 ) phase -= 1.0;
// 	return(output);

// }

float maxiOsc::sinebuf4(float frequency) {
	//This is a sinewave oscillator that uses 4 point interpolation on a 514 point buffer
	float remainder;
	float a,b,c,d,a1,a2,a3;
	phase += 512./(maxiSettings::sampleRate/(frequency));
	if ( phase >= 511 ) phase -=512;
	remainder = phase - floor(phase);

	if (phase==0) {
		a=sineBuffer[(long) 512];
		b=sineBuffer[(long) phase];
		c=sineBuffer[(long) phase+1];
		d=sineBuffer[(long) phase+2];

	} else {
		a=sineBuffer[(long) phase-1];
		b=sineBuffer[(long) phase];
		c=sineBuffer[(long) phase+1];
		d=sineBuffer[(long) phase+2];

	}

	a1 = 0.5f * (c - a);
	a2 = a - 2.5 * b + 2.f * c - 0.5f * d;
	a3 = 0.5f * (d - a) + 1.5f * (b - c);
	output = float (((a3 * remainder + a2) * remainder + a1) * remainder + b);
	return(output);
}


float maxiOsc::coswave(float frequency) {
	//This is a cosine oscillator
	output=cos (phase*(TWOPI));
	if ( phase >= 1.0 ) phase -= 1.0;
	phase += (1./(maxiSettings::sampleRate/(frequency)));
	return(output);

}

float maxiOsc::phasor(float frequency) {
	//This produces a floating point linear ramp between 0 and 1 at the desired frequency
	output=phase;
	if ( phase >= 1.0 ) phase -= 1.0;
	phase += (1./(maxiSettings::sampleRate/(frequency)));
	return(output);
}

// float maxiOsc::square(float frequency) {
// 	//This is a square wave
// 	if (phase<0.5) output=-1;
// 	if (phase>0.5) output=1;
// 	if ( phase >= 1.0 ) phase -= 1.0;
// 	phase += (1./(maxiSettings::sampleRate/(frequency)));
// 	return(output);
// }

float maxiOsc::pulse(float frequency, float duty) {
	//This is a pulse generator that creates a signal between -1 and 1.
	if (duty<0.) duty=0;
	if (duty>1.) duty=1;
	if ( phase >= 1.0 ) phase -= 1.0;
	phase += (1./(maxiSettings::sampleRate/(frequency)));
	if (phase<duty) output=-1.;
	if (phase>duty) output=1.;
	return(output);
}
float maxiOsc::impulse(float frequency) {
    //this is an impulse generator
    if ( phase >= 1.0 ) phase -= 1.0;
    float phaseInc = (1./(maxiSettings::sampleRate/(frequency)));
    float output = phase < phaseInc ? 1.0 : 0.0;
    phase += phaseInc;
    return output;
}

float maxiOsc::phasorBetween(float frequency, float startphase, float endphase) {
	//This is a phasor that takes a value for the start and end of the ramp.
	output=phase;
	if (phase<startphase) {
		phase=startphase;
	}
	if ( phase >= endphase ) phase = startphase;
	phase += ((endphase-startphase)/(maxiSettings::sampleRate/(frequency)));
	return(output);
}


float maxiOsc::saw(float frequency) {
	//Sawtooth generator. This is like a phasor but goes between -1 and 1
	output=phase;
	if ( phase >= 1.0 ) phase -= 2.0;
	phase += (1./(maxiSettings::sampleRate/(frequency))) * 2.0;
	return(output);

}

// float maxiOsc::sawn(float frequency) {
// 	//Bandlimited sawtooth generator. Woohoo.
// 	if ( phase >= 0.5 ) phase -= 1.0;
// 	phase += (1./(maxiSettings::sampleRate/(frequency)));
// 	float temp=(8820.22/frequency)*phase;
// 	if (temp<-0.5) {
// 		temp=-0.5;
// 	}
// 	if (temp>0.5) {
// 		temp=0.5;
// 	}
// 	temp*=1000.0f;
// 	temp+=500.0f;
// 	float remainder = temp - floor(temp);
// 	output = (float) ((1.0f-remainder) * transition[(long)temp] + remainder * transition[1+(long)temp]) - phase;
// 	return(output);

// }


float maxiOsc::triangle(float frequency) {
    float output;
	if ( phase >= 1.0f ) phase -= 1.0;
	phase += maxiSettings::one_over_sampleRate * frequency;
	if (phase <= 0.5f ) {
		output =(phase - 0.25f) * 4.f;
	} else {
		output =((1.0f-phase) - 0.25f) * 4.f;
	}
	return output;
}



//I particularly like these. cutoff between 0 and 1
float maxiFilter::lopass(float input, float cutoff) {
	output=outputs[0] + cutoff*(input-outputs[0]);
	outputs[0]=output;
	return(output);
}

//as above
float maxiFilter::hipass(float input, float cutoff) {
	output=input-(outputs[0] + cutoff*(input-outputs[0]));
	outputs[0]=output;
	return(output);
}


//This works a bit. Needs attention.
float maxiFilter::bandpass(float input,float cutoff1, float resonance) {
	cutoff=cutoff1;
	if (cutoff>(maxiSettings::sampleRate*0.5)) cutoff=(maxiSettings::sampleRate*0.5);
	if (resonance>=1.) resonance=0.999999;
	z=cos(TWOPI*cutoff/maxiSettings::sampleRate);
	inputs[0] = (1-resonance)*(sqrt(resonance*(resonance-4.0*pow(z,2.0)+2.0)+1));
	inputs[1] = 2*z*resonance;
	inputs[2] = pow((resonance*-1),2);

	output=inputs[0]*input+inputs[1]*outputs[1]+inputs[2]*outputs[2];
	outputs[2]=outputs[1];
	outputs[1]=output;
	return(output);
}

//stereo bus
void maxiMix::stereo(float input,std::vector<float>&two,float x) {
	if (x>1) x=1;
	if (x<0) x=0;
	two[0]=input*sqrt(1.0-x);
	two[1]=input*sqrt(x);
//	return two;
}

//quad bus
void maxiMix::quad(float input,std::vector<float>& four,float x,float y) {
	if (x>1) x=1;
	if (x<0) x=0;
	if (y>1) y=1;
	if (y<0) y=0;
	four[0]=input*sqrt((1.0-x)*y);
	four[1]=input*sqrt((1.0-x)*(1.0-y));
	four[2]=input*sqrt(x*y);
	four[3]=input*sqrt(x*(1.0-y));
//	return(four);
}

//ambisonic bus
void maxiMix::ambisonic(float input,std::vector<float>&eight,float x,float y,float z) {
	if (x>1) x=1;
	if (x<0) x=0;
	if (y>1) y=1;
	if (y<0) y=0;
	if (z>1) y=1;
	if (z<0) y=0;
	eight[0]=input*(sqrt((1.0-x)*y)*1.0-z);
	eight[1]=input*(sqrt((1.0-x)*(1.0-y))*1.0-z);
	eight[2]=input*(sqrt(x*y)*1.0-z);
	eight[3]=input*(sqrt(x*(1.0-y))*1.0-z);
	eight[4]=input*(sqrt((1.0-x)*y)*z);
	eight[5]=input*(sqrt((1.0-x)*(1.0-y))*z);
	eight[6]=input*sqrt((x*y)*z);
	eight[7]=input*sqrt((x*(1.0-y))*z);
}
// --------------------------------------------------------------------------------
// MAXI_SAMPLE


maxiSample::maxiSample():position(0), recordPosition(0), myChannels(1), mySampleRate(maxiSettings::sampleRate) {};



// -------------------------

//This sets the playback position to the start of a sample
void maxiSample::trigger() {
	position = 0;
	recordPosition = 0;
}


// string maxiSample::getSummary()
// {
//     std::stringstream ss;
//     ss << " Format: " << myFormat << "\n Channels: " << myChannels << "\n SampleRate: " << mySampleRate << 
// 	"\n ByteRate: " << myByteRate << "\n BlockAlign: " << myBlockAlign << "\n BitsPerSample: " << myBitsPerSample;
//     return ss.str();
// }


//This plays back at the correct speed. Always loops.
float maxiSample::play() {
    output = F64_ARRAY_AT(amplitudes,(long)position);
    position++;
		if ((long) position >= F64_ARRAY_SIZE(amplitudes)) {
			position = 0;
		}
    return output;
}

void maxiSample::setPosition(float newPos) {
	position = maxiMap::clamp(newPos, 0.0, 1.0) * F64_ARRAY_SIZE(amplitudes);
}

float maxiSample::playWithPhasor(float pha) {
	size_t amplen = F64_ARRAY_SIZE(amplitudes);
	//clamping
	if (pha > 1) pha=1;
	if (pha < 0) pha=0;
	float pos = pha * amplen * 0.99999999999999;

	if (phasorFirst) {
		phasorFirst=0;
		phasorPrev = pos;
	}

	size_t pos1 = static_cast<size_t>(round(phasorPrev));
	size_t pos2 = static_cast<size_t>(round(pos));
	if (pos1==pos2) {
		if (pos >= phasorPrev) {
			pos2++;
		}else{
			pos1--;
		}
	}

	//constraints / wrapping
	if (pos2 >= amplen) {
		pos2=0;
	}
	if (pos1 >= amplen) {
		pos1=0;
	}
	if (pos1 < 0) {
		pos1 = amplen-1;
	}
	if (pos2 < 0) {
		pos2 = amplen-1;
	}

	//get interpolation coeffs
	float q1,q2;
	if (pos2 > pos1) {
		float dist = pos2-pos1;
		if (dist == 0)
			q1 = 0;
		else
			q1 = (pos-pos1) / dist;
	}else {
		float dist = (amplen - pos1) + pos2;
		if (dist==0) 
			q1 = 0;
		else{
			if (pos > pos1) {
				q1 = (pos - pos1) / dist;
			}else{
				q1 = ((amplen - pos1) + pos) / dist;
			}
		}
	}
	q2 = 1 - q1;

	output = (q1 * F64_ARRAY_AT(amplitudes,pos1) +
							q2 * F64_ARRAY_AT(amplitudes,pos2));
	phasorPrev = pos;

	return output;
}





// placeholder
float maxiSample::playAtSpeedBetweenPoints(float frequency, float start, float end) {
	return playAtSpeedBetweenPointsFromPos(frequency, start, end, position);
}

//This allows you to say how often a second you want a specific chunk of audio to play
float maxiSample::playAtSpeedBetweenPointsFromPos(float frequency, float start, float end, float pos) {
	float remainder;
	size_t amplen = F64_ARRAY_SIZE(amplitudes);
	if (end>=amplen) end=amplen-1;
	long a,b;

	if (frequency >0.) {
		if (pos<start) {
			pos=start;
		}

		if ( pos >= end ) pos = start;
		pos += ((end-start)/((maxiSettings::sampleRate)/(frequency*chandiv)));
		remainder = pos - floor(pos);
		long posl = floor(pos);
		if (posl+1<amplen) {
			a=posl+1;
		}	else {
			a=posl-1;
		}
		if (posl+2<amplen) {
			b=posl+2;
		}
		else {
			b=amplen-1;
		}

		output = ((1-remainder) * F64_ARRAY_AT(amplitudes,a) +
						   remainder * F64_ARRAY_AT(amplitudes,b));//linear interpolation
	} else {
		frequency*=-1.;
		if ( pos <= start ) pos = end;
		pos -= ((end-start)/(maxiSettings::sampleRate/(frequency*chandiv)));
		remainder = pos - floor(pos);
		long posl = floor(pos);
		if (posl-1>=0) {
			a=posl-1;
		}
		else {
			a=0;
		}
		if (posl-2>=0) {
			b=posl-2;
		}
		else {
			b=0;
		}
		output = ((-1-remainder) * F64_ARRAY_AT(amplitudes,a) +
						   remainder * F64_ARRAY_AT(amplitudes,b));//linear interpolation
	}

	return(output);
}


//Same as above. better cubic inerpolation. Cobbled together from various (pd externals, yehar, other places).
float maxiSample::play4(float frequency, float start, float end) {
	float remainder;
	float a,b,c,d,a1,a2,a3;
	if (frequency >0.) {
		if (position<start) {
			position=start;
		}
		if ( position >= end ) position = start;
		position += ((end-start)/(maxiSettings::sampleRate/(frequency*chandiv)));
		remainder = position - floor(position);
		if (position>0) {
			a=F64_ARRAY_AT(amplitudes,(int)(floor(position))-1);

		} else {
			a=F64_ARRAY_AT(amplitudes,0);

		}

		b=F64_ARRAY_AT(amplitudes,(long) position);
		if (position<end-2) {
			c=F64_ARRAY_AT(amplitudes,(long) position+1);

		} else {
			c=F64_ARRAY_AT(amplitudes,0);

		}
		if (position<end-3) {
			d=	F64_ARRAY_AT(amplitudes,(long) position+2);

		} else {
			d=F64_ARRAY_AT(amplitudes,0);
		}
		a1 = 0.5f * (c - a);
		a2 = a - 2.5 * b + 2.f * c - 0.5f * d;
		a3 = 0.5f * (d - a) + 1.5f * (b - c);
		output = (((a3 * remainder + a2) * remainder + a1) * remainder + b);

	} else {
		frequency*=-1.;
		if ( position <= start ) position = end;
		position -= ((end-start)/(maxiSettings::sampleRate/(frequency*chandiv)));
		remainder = position - floor(position);
		if (position>start && position < end-1) {
			a=F64_ARRAY_AT(amplitudes,(long) position+1);

		} else {
			a=F64_ARRAY_AT(amplitudes,0);

		}

		b=F64_ARRAY_AT(amplitudes,(long) position);
		if (position>start) {
			c=F64_ARRAY_AT(amplitudes,(long) position-1);

		} else {
			c=F64_ARRAY_AT(amplitudes,0);

		}
		if (position>start+1) {
			d=F64_ARRAY_AT(amplitudes,(long) position-2);

		} else {
			d=F64_ARRAY_AT(amplitudes,0);
		}
		a1 = 0.5f * (c - a);
		a2 = a - 2.5 * b + 2.f * c - 0.5f * d;
		a3 = 0.5f * (d - a) + 1.5f * (b - c);
		output = (((a3 * remainder + a2) * -remainder + a1) * -remainder + b);

	}

	return(output);
}


//start end and points are between 0 and 1
float maxiSample::playLoop(float start, float end) {
	position++;
	auto sampleLength = F64_ARRAY_SIZE(amplitudes);
	if (position < sampleLength * start) position = sampleLength * start;
	if ((long) position >= sampleLength * end) position = sampleLength * start;
	output = F64_ARRAY_AT(amplitudes,(long)position);
	return output;
}

float maxiSample::playUntil(float end) {
	position++;
	if (end > 1.0) end = 1.0;
	if ((long) position<F64_ARRAY_SIZE(amplitudes) * end)
		output = F64_ARRAY_AT(amplitudes,(long)position);
	else {
		output=0;
	}
	return output;
}


//This plays back at the correct speed. Only plays once. To retrigger, you have to manually reset the position
float maxiSample::playOnce() {
	if ((long) position<F64_ARRAY_SIZE(amplitudes))
		output = F64_ARRAY_AT(amplitudes,(long)position);
	else {
		output=0;
	}
	position++;
	return output;

}

// //Same as above but takes a speed value specified as a ratio, with 1.0 as original speed
float maxiSample::playOnceAtSpeed(float speed) {
	float remainder = position - (long) position;
	if ((long) position+1<F64_ARRAY_SIZE(amplitudes))
		output = ((1-remainder) * F64_ARRAY_AT(amplitudes,(long) position) + remainder * 
		F64_ARRAY_AT(amplitudes,1+(long) position));//linear interpolation
	else
		output=0;
	position=position+((speed*chandiv)/(maxiSettings::sampleRate/mySampleRate));
	return(output);
}


float maxiSample::playOnZX(float trig) {
	if (zxTrig.onZX(trig)) {
		trigger();
	}
  return playOnce();
}

float maxiSample::playOnZXAtSpeed(float trig, float speed) {
	if (zxTrig.onZX(trig)) {
		trigger();
	}
  return playOnceAtSpeed(speed);
}

float maxiSample::playOnZXAtSpeedFromOffset(float trig, float speed, float offset) {
	if (zxTrig.onZX(trig)) {
		trigger();
		position = offset * F64_ARRAY_SIZE(amplitudes);
	}
  return playOnceAtSpeed(speed);
}

float maxiSample::playOnZXAtSpeedBetweenPoints(float trig, float speed, float offset, float length) {
	if (zxTrig.onZX(trig)) {
		trigger();
		position = offset * F64_ARRAY_SIZE(amplitudes);
	}
  return playUntilAtSpeed(offset+length, speed);
}


float maxiSample::loopSetPosOnZX(float trig, float pos) {
	if (zxTrig.onZX(trig)) {
		setPosition(pos);
	}
    return play();
}




float maxiSample::playUntilAtSpeed(float end, float speed) {
	float remainder = position - (long) position;
	if (end > 1.0) end = 1.0;
	if ((long) position<F64_ARRAY_SIZE(amplitudes) * end)
		output = ((1-remainder) * F64_ARRAY_AT(amplitudes,1+ (long) position) + remainder * 
		F64_ARRAY_AT(amplitudes,2+(long) position));//linear interpolation
	else
		output=0;

	position=position+((speed*chandiv)/(maxiSettings::sampleRate/mySampleRate));
	return output;
}

float maxiSample::playAtSpeed(float speed) {
	float remainder = position - (long) position;
	if ((long) position<F64_ARRAY_SIZE(amplitudes)) {
		output = ((1-remainder) * F64_ARRAY_AT(amplitudes,1+ (long) position) + remainder * 
		F64_ARRAY_AT(amplitudes,2+(long) position));//linear interpolation
	}
	else {
		output=0;
	}

	position=position+((speed*chandiv)/(maxiSettings::sampleRate/mySampleRate));
	if ((long) position >= F64_ARRAY_SIZE(amplitudes)) {
		position -= F64_ARRAY_SIZE(amplitudes);
	}
	return output;
}


//As above but looping
float maxiSample::play(float speed) {
	float remainder;
	long a,b;
	position=position+((speed*chandiv)/(maxiSettings::sampleRate/mySampleRate));
	if (speed >=0) {

		if ((long) position>=amplitudes.size()-1) position=1;
		remainder = position - floor(position);
		if (position+1<amplitudes.size()) {
			a=position+1;

		}
		else {
			a=amplitudes.size()-1;
		}
		if (position+2<amplitudes.size())
		{
			b=position+2;
		}
		else {
			b=amplitudes.size()-1;
		}

		output = ((1-remainder) * amplitudes[a] + remainder * amplitudes[b]);//linear interpolation
	} else {
		if ((long) position<0) position=amplitudes.size();
		remainder = position - floor(position);
		if (position-1>=0) {
			a=position-1;

		}
		else {
			a=0;
		}
		if (position-2>=0) {
			b=position-2;
		}
		else {
			b=0;
		}
		output = ((-1-remainder) * amplitudes[a] + remainder * amplitudes[b]);//linear interpolation
	}
	return(output);
}



void maxiSample::normalise(float maxLevel) {
	float maxValue = 0;
	for(int i=0; i < F64_ARRAY_SIZE(amplitudes); i++) {
		if (abs(F64_ARRAY_AT(amplitudes,i)) > maxValue) {
			maxValue = abs(F64_ARRAY_AT(amplitudes,i));
		}
	}
	float scale = maxLevel / maxValue;
	for(int i=0; i < F64_ARRAY_SIZE(amplitudes); i++) {
		F64_ARRAY_AT(amplitudes,i) = round(scale * F64_ARRAY_AT(amplitudes,i));
	}
}

void maxiSample::autoTrim(float alpha, float threshold, bool trimStart, bool trimEnd) {

    size_t startMarker=0;
    if(trimStart) {
        maxiLagExp<float> startLag(alpha, 0);
        while(startMarker < F64_ARRAY_SIZE(amplitudes)) {
            startLag.addSample(abs(F64_ARRAY_AT(amplitudes,startMarker)));
            if (startLag.value() > threshold) {
                break;
            }
            startMarker++;
        }
    }

    int endMarker = F64_ARRAY_SIZE(amplitudes)-1;
    if(trimEnd) {
        maxiLagExp<float> endLag(alpha, 0);
        while(endMarker > 0) {
            endLag.addSample(abs(F64_ARRAY_AT(amplitudes,endMarker)));
            if (endLag.value() > threshold) {
                break;
            }
            endMarker--;
        }
    }
    size_t newLength = endMarker - startMarker;
    if (newLength > 0) {
				DECLARE_F64_ARRAY(newAmps)
				F64_ARRAY_SETFROM(amplitudes, newAmps);
        // vector<float> newAmps(newLength);
        for(int i=0; i < newLength; i++) {
            newAmps[i] = F64_ARRAY_AT(amplitudes,i+startMarker);
        }

        // amplitudes = newAmps;
				F64_ARRAY_SETFROM(newAmps, amplitudes);
        position=0;
        recordPosition=0;
        //envelope the start
				size_t fadeSize = 100;
				if (F64_ARRAY_SIZE(amplitudes) > fadeSize)
					fadeSize = F64_ARRAY_SIZE(amplitudes);
        for(int i=0; i < fadeSize; i++) {
            float factor = i / (float) fadeSize;
            F64_ARRAY_AT(amplitudes,i) = round(F64_ARRAY_AT(amplitudes,i) * factor);
            F64_ARRAY_AT(amplitudes,F64_ARRAY_SIZE(amplitudes) - 1 - i) = round(F64_ARRAY_AT(amplitudes,F64_ARRAY_SIZE(amplitudes) - 1 - i) * factor);
        }
    }
}





// /* OK this compressor and gate are now ready to use. The envelopes, like all the envelopes in this recent update, use stupid algorithms for
//  incrementing - consequently a long attack is something like 0.0001 and a long release is like 0.9999.
//  Annoyingly, a short attack is 0.1, and a short release is 0.99. I'll sort this out laters */

// float maxiDyn::gate(float input, float threshold, long holdtime, float attack, float release) {

// 	if (fabs(input)>threshold && attackphase!=1){
// 		holdcount=0;
// 		releasephase=0;
// 		attackphase=1;
// 		if(amplitude==0) amplitude=0.01;
// 	}

// 	if (attackphase==1 && amplitude<1) {
// 		amplitude*=(1+attack);
// 		output=input*amplitude;
// 	}

// 	if (amplitude>=1) {
// 		attackphase=0;
// 		holdphase=1;
// 	}

// 	if (holdcount<holdtime && holdphase==1) {
// 		output=input;
// 		holdcount++;
// 	}

// 	if (holdcount==holdtime) {
// 		holdphase=0;
// 		releasephase=1;
// 	}

// 	if (releasephase==1 && amplitude>0.) {
// 		output=input*(amplitude*=release);

// 	}

// 	return output;
// }


// float maxiDyn::compressor(float input, float ratio, float threshold, float attack, float release) {

// 	if (fabs(input)>threshold && attackphase!=1){
// 		holdcount=0;
// 		releasephase=0;
// 		attackphase=1;
// 		if(currentRatio==0) currentRatio=ratio;
// 	}

// 	if (attackphase==1 && currentRatio<ratio-1) {
// 		currentRatio*=(1+attack);
// 	}

// 	if (currentRatio>=ratio-1) {
// 		attackphase=0;
// 		releasephase=1;
// 	}

// 	if (releasephase==1 && currentRatio>0.) {
// 		currentRatio*=release;
// 	}

// 	if (input>0.) {
// 		output = input/(1.+currentRatio);
// 	} else {
// 		output = input/(1.+currentRatio);
// 	}

// 	return output*(1+log(ratio));
// }

// float maxiDyn::compress(float input) {

// 	if (fabs(input)>threshold && attackphase!=1){
// 		holdcount=0;
// 		releasephase=0;
// 		attackphase=1;
// 		if(currentRatio==0) currentRatio=ratio;
// 	}

// 	if (attackphase==1 && currentRatio<ratio-1) {
// 		currentRatio*=(1+attack);
// 	}

// 	if (currentRatio>=ratio-1) {
// 		attackphase=0;
// 		releasephase=1;
// 	}

// 	if (releasephase==1 && currentRatio>0.) {
// 		currentRatio*=release;
// 	}

// 	if (input>0.) {
// 		output = input/(1.+currentRatio);
// 	} else {
// 		output = input/(1.+currentRatio);
// 	}

// 	return output*(1+log(ratio));
// }

// void maxiDyn::setAttack(float attackMS) {
// 	attack = pow( 0.01, 1.0 / ( attackMS * maxiSettings::sampleRate * 0.001 ) );
// }

// void maxiDyn::setRelease(float releaseMS) {
// 	release = pow( 0.01, 1.0 / ( releaseMS * maxiSettings::sampleRate * 0.001 ) );
// }

// void maxiDyn::setThreshold(float thresholdI) {
// 	threshold = thresholdI;
// }

// void maxiDyn::setRatio(float ratioF) {
// 	ratio = ratioF;
// }

// /* Lots of people struggle with the envelope generators so here's a new easy one.
//  It takes mental numbers for attack and release tho. Basically, they're exponentials.
//  I'll map them out later so that it's a bit more intuitive */
// float maxiEnv::ar(float input, float attack, float release, long holdtime, int trigger) {

// 	if (trigger==1 && attackphase!=1 && holdphase!=1){
// 		holdcount=0;
// 		releasephase=0;
// 		attackphase=1;
// 	}

// 	if (attackphase==1) {
// 		amplitude+=(1*attack);
// 		output=input*amplitude;
// 	}

// 	if (amplitude>=1) {
// 		amplitude=1;
// 		attackphase=0;
// 		holdphase=1;
// 	}

// 	if (holdcount<holdtime && holdphase==1) {
// 		output=input;
// 		holdcount++;
// 	}

// 	if (holdcount==holdtime && trigger==1) {
// 		output=input;
// 	}

// 	if (holdcount==holdtime && trigger!=1) {
// 		holdphase=0;
// 		releasephase=1;
// 	}

// 	if (releasephase==1 && amplitude>0.) {
// 		output=input*(amplitude*=release);

// 	}

// 	return output;
// }

// /* adsr. It's not bad, very simple to use*/

// float maxiEnv::adsr(float input, float attack, float decay, float sustain, float release, long holdtime, int trigger) {

// 	if (trigger==1 && attackphase!=1 && holdphase!=1 && decayphase!=1){
// 		holdcount=0;
// 		decayphase=0;
// 		sustainphase=0;
// 		releasephase=0;
// 		attackphase=1;
// 	}

// 	if (attackphase==1) {
// 		releasephase=0;
// 		amplitude+=(1*attack);
// 		output=input*amplitude;

// 		if (amplitude>=1) {
// 			amplitude=1;
// 			attackphase=0;
// 			decayphase=1;
// 		}
// 	}


// 	if (decayphase==1) {
// 		output=input*(amplitude*=decay);
// 		if (amplitude<=sustain) {
// 			decayphase=0;
// 			holdphase=1;
// 		}
// 	}

// 	if (holdcount<holdtime && holdphase==1) {
// 		output=input*amplitude;
// 		holdcount++;
// 	}

// 	if (holdcount>=holdtime && trigger==1) {
// 		output=input*amplitude;
// 	}

// 	if (holdcount>=holdtime && trigger!=1) {
// 		holdphase=0;
// 		releasephase=1;
// 	}

// 	if (releasephase==1 && amplitude>0.) {
// 		output=input*(amplitude*=release);

// 	}

// 	return output;
// }

// float maxiEnv::adsr(float input, int trigger) {

// 	if (trigger==1 && attackphase!=1 && holdphase!=1 && decayphase!=1){
// 		holdcount=0;
// 		decayphase=0;
// 		sustainphase=0;
// 		releasephase=0;
// 		attackphase=1;
// 	}

// 	if (attackphase==1) {
// 		releasephase=0;
// 		amplitude+=(1*attack);
// 		output=input*amplitude;

// 		if (amplitude>=1) {
// 			amplitude=1;
// 			attackphase=0;
// 			decayphase=1;
// 		}
// 	}


// 	if (decayphase==1) {
// 		output=input*(amplitude*=decay);
// 		if (amplitude<=sustain) {
// 			decayphase=0;
// 			holdphase=1;
// 		}
// 	}

// 	if (holdcount<holdtime && holdphase==1) {
// 		output=input*amplitude;
// 		holdcount++;
// 	}

// 	if (holdcount>=holdtime && trigger==1) {
// 		output=input*amplitude;
// 	}

// 	if (holdcount>=holdtime && trigger!=1) {
// 		holdphase=0;
// 		releasephase=1;
// 	}

// 	if (releasephase==1 && amplitude>0.) {
// 		output=input*(amplitude*=release);

// 	}

// 	return output;
// }


// void maxiEnv::setRelease(float releaseMS) {
// 	release = pow( 0.01, 1.0 / ( releaseMS * maxiSettings::sampleRate * 0.001 ) );
// }


// void maxiEnv::setDecay(float decayMS) {
// 	decay = pow( 0.01, 1.0 / ( decayMS * maxiSettings::sampleRate * 0.001 ) );
// }

// //old method - depreacated
// void maxiEnv::setAttack(float attackMS) {
// 	attack = 1-pow( 0.01, 1.0 / ( attackMS * maxiSettings::sampleRate * 0.001 ) );
// }

// //new method - in MS

// void maxiEnv::setAttackMS(float attackMS) {
// 	attack = 1.0 / (attackMS /1000.0 *  maxiSettings::sampleRate);
// }

// ////


// void maxiEnv::setSustain(float sustainL) {
// 	sustain = sustainL;
// }



// float convert::mtof(int midinote) {
// 	return mtofarray[midinote];
// }


// template<> void maxiEnvelopeFollower::setAttack(float attackMS) {
// 	attack = pow( 0.01, 1.0 / ( attackMS * maxiSettings::sampleRate * 0.001 ) );
// }

// template<> void maxiEnvelopeFollower::setRelease(float releaseMS) {
// 	release = pow( 0.01, 1.0 / ( releaseMS * maxiSettings::sampleRate * 0.001 ) );
// }


//there are a bunch of constructors here. it's a quirk of CHEERP that constructors need to be defined in the cpp unless completely header only
maxiRatioSeq::maxiRatioSeq() {}
maxiTrigger::maxiTrigger() {}
maxiMap::maxiMap() {}
maxiFilter::maxiFilter():x(0.0), y(0.0), z(0.0), c(0.0) {}
maxiZeroCrossingDetector::maxiZeroCrossingDetector() {}
maxiIndex::maxiIndex() {}
maxiZXToPulse::maxiZXToPulse() {}
maxiStep::maxiStep() {}
maxiSelect::maxiSelect() {}
maxiSelectX::maxiSelectX() {}
maxiEnvGen::maxiEnvGen() {}
maxiRingBuf::maxiRingBuf() {}
maxiPoll::maxiPoll() {}
maxiRMS::maxiRMS() {}
maxiZeroCrossingRate::maxiZeroCrossingRate() {
	buf.setup(maxiSettings::sampleRate);
}