import { describe, expect, it } from 'vitest';
import { isPublicAddress } from './publicAddress.js';

/** Addresses written as a table, one per line, as `publicAddress.ts` writes its ranges. */
const listed = (table: string) => table.trim().split(/\s+/);

describe('the addresses the website check may connect to (#2165)', () => {
  it('admits public addresses of both families', () => {
    for (const address of listed(`
      8.8.8.8
      151.101.1.69
      2606:4700::6810:84e5
      2a00:1450:4001:82a::200e
    `)) expect(isPublicAddress(address), address).toBe(true);
  });

  it('refuses this machine, its networks and the cloud metadata services', () => {
    for (const address of listed(`
      127.0.0.1
      10.0.0.5
      172.16.4.1
      192.168.1.1
      169.254.169.254
      100.64.0.1
      0.0.0.0
      ::1
      ::
      fd00:ec2::254
      fe80::1
      fc00::1
    `)) expect(isPublicAddress(address), address).toBe(false);
  });

  it('refuses a private address carried inside an IPv6 one', () => {
    for (const address of listed(`
      ::ffff:10.0.0.1
      ::ffff:127.0.0.1
      ::ffff:a00:1
      ::ffff:7f00:1
      ::ffff:a9fe:a9fe
      0:0:0:0:0:ffff:7f00:1
      2002:a00:1::
      64:ff9b::a00:1
      2001::1
    `)) expect(isPublicAddress(address), address).toBe(false);
  });

  it('refuses documentation, benchmarking, multicast and reserved ranges', () => {
    for (const address of listed(`
      192.0.2.1
      198.51.100.7
      203.0.113.9
      198.18.0.1
      224.0.0.1
      255.255.255.255
      2001:db8::1
      ff02::1
    `)) expect(isPublicAddress(address), address).toBe(false);
  });

  it('refuses what is not an address at all', () => {
    expect(isPublicAddress('localhost')).toBe(false);
    expect(isPublicAddress('')).toBe(false);
  });
});
