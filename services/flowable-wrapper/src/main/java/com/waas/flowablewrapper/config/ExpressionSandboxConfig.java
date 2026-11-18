package com.waas.flowablewrapper.config;

import java.beans.FeatureDescriptor;
import java.lang.reflect.AccessibleObject;
import java.lang.reflect.Member;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

import org.flowable.cmmn.spring.SpringCmmnEngineConfiguration;
import org.flowable.common.engine.impl.javax.el.ELContext;
import org.flowable.common.engine.impl.javax.el.ELException;
import org.flowable.common.engine.impl.javax.el.ELResolver;
import org.flowable.dmn.spring.SpringDmnEngineConfiguration;
import org.flowable.spring.SpringProcessEngineConfiguration;
import org.flowable.spring.boot.EngineConfigurationConfigurer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Expressions in deployed models (${...}) are written by tenant admins, so
 * they must not reach beyond the instance they run in. Two holes are closed
 * here, for the process, CMMN and DMN engines:
 * <ul>
 * <li>Spring beans: Flowable exposes every bean to expressions by default, so
 *     {@code ${environment.getProperty('cwp.jwt.secret')}} read the token
 *     signing key and {@code ${jdbcTemplate...}} any tenant's data. The beans
 *     map is set empty: expressions see variables and functions only.</li>
 * <li>Reflection: JUEL calls methods on any object, so
 *     {@code ${''.getClass().forName('java.lang.Runtime')...}} reached
 *     arbitrary code execution. {@link ReflectionBlockingResolver} refuses it.</li>
 * </ul>
 * Script tasks are a separate, platform opt-in (deployment/ScriptPolicy).
 */
@Configuration
public class ExpressionSandboxConfig {

    @Bean
    EngineConfigurationConfigurer<SpringProcessEngineConfiguration> processExpressionSandbox() {
        return config -> {
            config.setBeans(new HashMap<>());
            config.addPreDefaultELResolver(new ReflectionBlockingResolver());
        };
    }

    @Bean
    EngineConfigurationConfigurer<SpringCmmnEngineConfiguration> cmmnExpressionSandbox() {
        return config -> {
            config.setBeans(new HashMap<>());
            config.setPreDefaultELResolvers(List.of(new ReflectionBlockingResolver()));
        };
    }

    @Bean
    EngineConfigurationConfigurer<SpringDmnEngineConfiguration> dmnExpressionSandbox() {
        return config -> {
            config.setBeans(new HashMap<>());
            config.setPreDefaultELResolvers(List.of(new ReflectionBlockingResolver()));
        };
    }

    /**
     * Runs before Flowable's own resolvers and refuses anything that leads to
     * reflection or process control; everything else passes through untouched.
     */
    public static final class ReflectionBlockingResolver extends ELResolver {

        static final Set<String> BLOCKED_METHODS = Set.of(
                "getClass", "forName", "getClassLoader", "loadClass", "defineClass", "newInstance",
                "getMethod", "getMethods", "getDeclaredMethod", "getDeclaredMethods", "getField", "getFields",
                "getDeclaredField", "getDeclaredFields", "getConstructor", "getConstructors",
                "getDeclaredConstructor", "getDeclaredConstructors", "invoke", "setAccessible",
                "exec", "getRuntime", "exit", "halt", "load", "loadLibrary", "start");

        static final Set<String> BLOCKED_PROPERTIES = Set.of("class", "classLoader", "declaringClass", "module");

        private static boolean dangerous(Object base) {
            return base instanceof Class<?> || base instanceof ClassLoader || base instanceof Member
                    || base instanceof AccessibleObject || base instanceof Runtime || base instanceof ProcessBuilder
                    || base instanceof Process || base instanceof Thread || base instanceof Module;
        }

        private static ELException refused(Object what) {
            return new ELException("'" + what + "' is not allowed in expressions (no reflection or process control).");
        }

        @Override
        public Object invoke(ELContext context, Object base, Object method, Class<?>[] paramTypes, Object[] params) {
            if (base != null && (dangerous(base) || BLOCKED_METHODS.contains(String.valueOf(method)))) {
                throw refused(method);
            }
            return null;
        }

        @Override
        public Object getValue(ELContext context, Object base, Object property) {
            if (base != null && (dangerous(base) || BLOCKED_PROPERTIES.contains(String.valueOf(property)))) {
                throw refused(property);
            }
            return null;
        }

        @Override
        public Class<?> getType(ELContext context, Object base, Object property) {
            return null;
        }

        @Override
        public void setValue(ELContext context, Object base, Object property, Object value) {
            if (base != null && (dangerous(base) || BLOCKED_PROPERTIES.contains(String.valueOf(property)))) {
                throw refused(property);
            }
        }

        @Override
        public boolean isReadOnly(ELContext context, Object base, Object property) {
            return false;
        }

        public Iterator<FeatureDescriptor> getFeatureDescriptors(ELContext context, Object base) {
            return null;
        }

        @Override
        public Class<?> getCommonPropertyType(ELContext context, Object base) {
            return null;
        }
    }
}
