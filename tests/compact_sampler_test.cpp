#include "../src/firmware/synth/CompactSamplerCodec.h"
#include <cassert>
#include <vector>
#include <fstream>

using namespace CompactSampler;
void put16(uint8_t* p, uint16_t v) { p[0]=v; p[1]=v>>8; }
void put32(uint8_t* p, uint32_t v) { put16(p,v);put16(p+2,v>>16); }
void putFloat(uint8_t* p,float f) { uint32_t n;memcpy(&n,&f,4);put32(p,n); }
void seal(std::vector<uint8_t>& b) { put32(b.data()+20,0);put32(b.data()+20,~crcUpdate(~0u,b.data(),b.size())); }
std::vector<uint8_t> fixture() {
  std::vector<uint8_t> b(kHeader+kAsset+kZone); auto* p=b.data();
  memcpy(p,"HBC1",4);put16(p+4,1);put16(p+6,kHeader);put32(p+8,b.size()+10);put32(p+12,5);put16(p+24,1);put16(p+26,1);
  memcpy(p+32,"Synthetic odd loop",18);auto* a=p+kHeader;put32(a+4,5);put32(a+8,1);put32(a+12,4);putFloat(a+16,22050);putFloat(a+20,440);a[24]=1;
  auto* z=a+kAsset;z[2]=1;z[3]=127;putFloat(z+4,10);putFloat(z+8,30000);put16(z+12,32768);put16(z+14,256);put16(z+20,65535);put16(z+22,100);
  seal(b);return b;
}
int main(int argc,char** argv) {
  auto b=fixture();Directory d;assert(d.decode(b.data(),b.size()));assert(d.region(440,127)==0);assert(d.region(1,127)==-1);
  for(unsigned at: {0u,4u,6u,8u,12u,20u,24u,26u}) {auto damaged=b;damaged[at]^=128;assert(!d.decode(damaged.data(),damaged.size()));}
  auto reject=[&](unsigned offset,uint32_t value){auto damaged=b;put32(damaged.data()+offset,value);seal(damaged);assert(!d.decode(damaged.data(),damaged.size()));};
  reject(64,1);reject(68,0xffffffffu);reject(72,4);reject(76,6);reject(80,0x7fc00000u);reject(96+4,0x7f800000u);reject(96+28,1);
  assert(d.decode(b.data(),b.size()));
  const int16_t pcm[5]={0,1000,2000,3000,4000};Reader r;r.start();
  for(int expected: {0,1000,2000,3000,1000,2000,3000,1000}) assert(r.read(d.recordings[0],pcm,65536)==expected);
  r.start();r.position=3*65536+32768;assert(r.read(d.recordings[0],pcm,65536)==2000); // wrap interpolation
  r.start();for(unsigned i=0;i<10000;++i) {r.read(d.recordings[0],pcm,64*65536);assert(!r.ended);}
  auto a=d.recordings[0];a.mode=3;r.start();for(int expected:{0,1000,2000,3000})assert(r.read(a,pcm,65536)==expected);
  r.released=true;assert(r.read(a,pcm,65536)==4000);assert(r.read(a,pcm,65536)==0);assert(r.ended);
  a.mode=0;r.start();for(int expected:{0,1000,2000,3000,4000,0})assert(r.read(a,pcm,65536)==expected);assert(r.ended);
  // Also validate browser-produced and personal files without embedding them.
  for(int i=1;i<argc;++i) {
    std::ifstream f(argv[i],std::ios::binary);std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(f)),{});assert(bytes.size()>=64);
    unsigned meta=kHeader+u16(bytes.data()+24)*kAsset+u16(bytes.data()+26)*kZone;
    assert(meta<=bytes.size()&&d.decode(bytes.data(),meta));assert(d.total==bytes.size());assert(~crcUpdate(~0u,bytes.data()+meta,bytes.size()-meta)==d.pcmCrc);
    std::vector<int16_t> pool(d.frames);memcpy(pool.data(),bytes.data()+meta,d.frames*2);
    for(unsigned asset=0;asset<d.assets;++asset) {r.start();for(unsigned frame=0;frame<50000;++frame)r.read(d.recordings[asset],pool.data(),uint32_t((frame%64+1)*65536+123));}
  }
}
