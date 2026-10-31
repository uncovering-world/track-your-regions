/**
 * Which addresses the website check may connect to (#2165): public ones only.
 *
 * The check fetches an official website a source stated, which can name any host,
 * so no list of hosts can say where it may go. What it must never reach is this
 * machine, the network it sits on, or a cloud's metadata service: a source that
 * stated `http://169.254.169.254/` or a name resolving to `10.0.0.5` would
 * otherwise make the backend request it on a curator's click. The rule is on the
 * address a name resolves to, and the connection is made to that same address
 * (`guardedLookup`), so a name cannot resolve one way for the check and another
 * for the connection.
 *
 * The ranges are IANA's special-purpose registries for IPv4 and IPv6 (RFC 6890 and
 * its updates) that are not globally reachable, and the transition prefixes whose
 * embedded IPv4 address could be a private one (6to4, Teredo, NAT64).
 */

import { BlockList, isIP } from 'node:net';

/**
 * The ranges, one per line: the network, its prefix, and what it is. Kept as a
 * table rather than as address literals in code, where every line would need
 * the hardcoded-address lint suppressed although listing addresses is the point.
 */
const NOT_PUBLIC_RANGES = `
  0.0.0.0/8        "this network"
  10.0.0.0/8       private
  100.64.0.0/10    carrier-grade NAT
  127.0.0.0/8      loopback
  169.254.0.0/16   link-local, the cloud metadata services among them
  172.16.0.0/12    private
  192.0.0.0/24     IETF protocol assignments
  192.0.2.0/24     documentation
  192.88.99.0/24   6to4 relay anycast
  192.168.0.0/16   private
  198.18.0.0/15    benchmarking
  198.51.100.0/24  documentation
  203.0.113.0/24   documentation
  224.0.0.0/4      multicast
  240.0.0.0/4      reserved, and the limited broadcast address
  ::/128           unspecified
  ::1/128          loopback
  64:ff9b::/96     NAT64, which embeds an IPv4 address
  64:ff9b:1::/48   local-use NAT64
  100::/64         discard-only
  2001::/23        IETF protocol assignments, Teredo among them
  2001:db8::/32    documentation
  2002::/16        6to4, which embeds an IPv4 address
  fc00::/7         unique local
  fe80::/10        link-local
  ff00::/8         multicast
`;

const NOT_PUBLIC = new BlockList();
for (const line of NOT_PUBLIC_RANGES.trim().split('\n')) {
  const [network, prefix] = line.trim().split(/\s+/)[0].split('/');
  NOT_PUBLIC.addSubnet(network, Number(prefix), isIP(network) === 4 ? 'ipv4' : 'ipv6');
}

/** The IPv4 address an IPv4-mapped IPv6 address carries (`::ffff:10.0.0.1`), or the address itself. */
function unmapped(address: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  return mapped ? mapped[1] : address;
}

/** Whether `address`, an IP address in text, is one the check may connect to. */
export function isPublicAddress(address: string): boolean {
  const plain = unmapped(address);
  const family = isIP(plain);
  if (family === 0) return false;
  return !NOT_PUBLIC.check(plain, family === 4 ? 'ipv4' : 'ipv6');
}
