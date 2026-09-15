#include "../src/firmware/midi/DelegatedLease.h"
#include <cassert>
#include <cstdio>

int main() {
  DelegatedLease lease;
  assert(!lease.expired(100000));
  assert(!lease.renew(123, 100));  // Heartbeats cannot enter a session.
  lease.begin(123, 100);
  assert(!lease.expired(5099));
  assert(lease.expired(5100));
  assert(!lease.renew(456, 5000));
  assert(lease.expired(5100));  // Another host cannot extend ownership.
  assert(lease.renew(123, 5000));
  assert(!lease.expired(9999));
  assert(lease.expired(10000));
  assert(lease.end() == 123);
  assert(!lease.expired(100000));  // Legacy mode can run without a lease.
  assert(!lease.renew(123, 100000));
  lease.begin(456, UINT32_MAX - 999);
  assert(!lease.expired(3999));
  assert(lease.expired(4000));
  assert(!lease.renew(456, 4000));  // A late heartbeat cannot revive an expired lease.
  lease.end();
  lease.begin(456, 4000);
  assert(!lease.expired(8999));
  assert(lease.expired(9000));
  lease.begin(789, 10000);
  assert(lease.renew(789, 11001));
  assert(!lease.expired(11000));  // 'now' sampled just before the other core renewed.
  assert(!lease.expired(16000));
  assert(lease.expired(16001));
  lease.begin(789, UINT32_MAX - 100);
  assert(lease.renew(789, 0));
  assert(!lease.expired(UINT32_MAX));
  std::puts("Delegated lease tests passed");
}
