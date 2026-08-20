package mitm

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"math/big"
	"net"
	"time"
)

// IssueLeafCert generates a fresh key pair and a short-lived server
// certificate for hostname, signed by the org's CA, and returns both PEMs.
//
// The leaf private key is generated here (server-side), not by the agent —
// the alternative (agent generates its own key, sends admin-api a CSR)
// would need CSR/keygen tooling on the client, and neither a bundled
// `cryptography` dependency nor a guaranteed `openssl` binary is available
// stdlib-only across macOS/Windows/Linux, which is the one constraint this
// agent has held to everywhere else. Trade-off, stated plainly: the leaf
// key transits the same authenticated HTTPS channel the CA cert and every
// policy the agent already trusts travels over, and it's scoped to one
// host for 72h — a leak yields impersonation of exactly that host, to
// exactly that org's own devices, for at most three days. The CA private
// key itself never leaves admin-api; that's the key whose compromise would
// actually matter, and it's unaffected by this trade-off.
func IssueLeafCert(ca *CA, hostname string) (certPEM, keyPEM []byte, err error) {
	if hostname == "" {
		return nil, nil, errors.New("hostname is required")
	}

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}

	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, nil, err
	}

	notBefore := time.Now().Add(-10 * time.Minute) // tolerate client clock skew
	notAfter := time.Now().Add(LeafCertValidity)

	template := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: hostname, Organization: []string{"Aavishield SSL Inspection"}},
		NotBefore:    notBefore,
		NotAfter:     notAfter,
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:     []string{hostname},
	}
	if ip := net.ParseIP(hostname); ip != nil {
		template.DNSNames = nil
		template.IPAddresses = []net.IP{ip}
	}

	certDER, err := x509.CreateCertificate(rand.Reader, template, ca.Cert, &key.PublicKey, ca.Key)
	if err != nil {
		return nil, nil, err
	}

	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return nil, nil, err
	}

	certPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	keyPEM = pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	return certPEM, keyPEM, nil
}
