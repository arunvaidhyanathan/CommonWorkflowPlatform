package com.waas.identity.config;

import java.security.KeyFactory;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateCrtKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.RSAPublicKeySpec;
import java.util.Base64;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.jwk.RSAKey;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Loads the RSA key that signs login tokens, or makes a throwaway one for local dev. */
final class SigningKeys {

    private static final Logger log = LoggerFactory.getLogger(SigningKeys.class);

    private SigningKeys() {
    }

    /**
     * The configured key, or -- only when {@code allowEphemeral} (local
     * development) -- a new one. Without a configured key every replica
     * would sign with its own key and reject the others' tokens, so a
     * missing key fails startup by default.
     */
    static RSAKey load(String pem, boolean allowEphemeral) {
        if ((pem == null || pem.isBlank()) && !allowEphemeral) {
            throw new IllegalStateException("CWP_JWT_PRIVATE_KEY is not set. Every identity-service replica must sign "
                    + "with the same key: set it from a Secret, or set CWP_JWT_ALLOW_EPHEMERAL_KEY=true for local development.");
        }
        try {
            if (pem == null || pem.isBlank()) {
                log.warn("CWP_JWT_PRIVATE_KEY is not set: generated a throwaway signing key. "
                        + "Tokens stop working when this process restarts. Local development only.");
                KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
                generator.initialize(2048);
                var pair = generator.generateKeyPair();
                return build((RSAPublicKey) pair.getPublic(), (RSAPrivateCrtKey) pair.getPrivate());
            }
            String body = pem.replaceAll("-----(BEGIN|END) PRIVATE KEY-----", "").replaceAll("\\s", "");
            KeyFactory factory = KeyFactory.getInstance("RSA");
            var privateKey = (RSAPrivateCrtKey) factory.generatePrivate(
                    new PKCS8EncodedKeySpec(Base64.getDecoder().decode(body)));
            var publicKey = (RSAPublicKey) factory.generatePublic(
                    new RSAPublicKeySpec(privateKey.getModulus(), privateKey.getPublicExponent()));
            return build(publicKey, privateKey);
        } catch (Exception e) {
            throw new IllegalStateException("CWP_JWT_PRIVATE_KEY must be a PKCS#8 PEM RSA private key", e);
        }
    }

    private static RSAKey build(RSAPublicKey publicKey, RSAPrivateCrtKey privateKey) throws JOSEException {
        return new RSAKey.Builder(publicKey).privateKey(privateKey).keyIDFromThumbprint().build();
    }
}
