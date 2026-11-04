package main

import "testing"

func TestSynMSS(t *testing.T) {
	// IPv4, 20-byte header, TCP with NOP NOP MSS 1452
	v4 := make([]byte, 20+28)
	v4[0], v4[9] = 0x45, 6
	tcp := v4[20:]
	tcp[12] = 7 << 4
	copy(tcp[20:], []byte{1, 1, 2, 4, 0x05, 0xac, 0, 0})
	if m := synMSS(v4); m != 1452 {
		t.Fatalf("v4: %d", m)
	}
	// IPv6, TCP with MSS 1220 first
	v6 := make([]byte, 40+24)
	v6[0], v6[6] = 0x60, 6
	tcp = v6[40:]
	tcp[12] = 6 << 4
	copy(tcp[20:], []byte{2, 4, 0x04, 0xc4})
	if m := synMSS(v6); m != 1220 {
		t.Fatalf("v6: %d", m)
	}
	if synMSS(nil) != 0 || synMSS(v6[:50]) != 0 {
		t.Fatal("short")
	}
	// a broken option length stops the walk
	copy(tcp[20:], []byte{3, 0, 0, 0})
	if synMSS(v6) != 0 {
		t.Fatal("bad length")
	}
}

func TestFilterJumps(t *testing.T) {
	f := synFilter(8446)
	for i, x := range f {
		if x.Code&0x07 == 0x05 && (i+1+int(x.Jt) >= len(f) || i+1+int(x.Jf) >= len(f)) {
			t.Fatalf("jump out of range at %d", i)
		}
	}
	if len(f) != 21 {
		t.Fatalf("%d instructions", len(f))
	}
}
