package com.waas.flowablewrapper;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * flowable-wrapper: CWP's Flowable engine host. Embeds Flowable 8 and serves
 * every engine endpoint under {@code /runtime/**} (public {@code /api/flowable/**}),
 * backed by the {@code runtime} schema. See this service's README.md.
 */
@SpringBootApplication
public class FlowableWrapperApplication {

    public static void main(String[] args) {
        SpringApplication.run(FlowableWrapperApplication.class, args);
    }
}
