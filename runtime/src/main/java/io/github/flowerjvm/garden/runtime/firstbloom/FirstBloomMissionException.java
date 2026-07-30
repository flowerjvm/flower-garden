package io.github.flowerjvm.garden.runtime.firstbloom;

final class FirstBloomMissionException extends IllegalStateException {

    private final String code;

    FirstBloomMissionException(String code, String message) {
        super(message);
        this.code = code;
    }

    String code() {
        return code;
    }
}
