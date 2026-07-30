package io.github.flowerjvm.garden.runtime.firstbloom;

/**
 * Domain facts for one First Bloom run.
 *
 * <p>The Bloom event is a wake-up hint. Steps decide from these stored facts,
 * so an event published before the waiting Step enters is not lost.
 */
final class FirstBloomPlotState {

    enum GardenState {
        EMPTY,
        SOIL_READY,
        SUNLIGHT_READY,
        STEM_GROWN,
        BLOOMED
    }

    private boolean soilPrepared;
    private boolean sunlightGranted;
    private boolean sunlightAccepted;
    private boolean stemGrown;
    private boolean bloomed;

    synchronized void prepareSoil() {
        soilPrepared = true;
    }

    synchronized void grantSunlight() {
        sunlightGranted = true;
    }

    synchronized boolean soilPrepared() {
        return soilPrepared;
    }

    synchronized boolean sunlightGranted() {
        return sunlightGranted;
    }

    synchronized void acceptSunlight() {
        if (!sunlightGranted) {
            throw new IllegalStateException("Sunlight cannot be accepted before it is granted.");
        }
        sunlightAccepted = true;
    }

    synchronized void growStem() {
        if (!soilPrepared) {
            throw new FirstBloomMissionException(
                    "SOIL_NOT_READY",
                    "grow-stem needs prepare-soil to finish first.");
        }
        if (!sunlightAccepted) {
            throw new FirstBloomMissionException(
                    "SUNLIGHT_NOT_READY",
                    "grow-stem needs wait-for-sunlight to accept the Bloom event first.");
        }
        stemGrown = true;
    }

    synchronized void bloom() {
        if (!stemGrown) {
            throw new FirstBloomMissionException(
                    "STEM_NOT_GROWN",
                    "bloom needs grow-stem to finish first.");
        }
        bloomed = true;
    }

    synchronized GardenState gardenState() {
        if (bloomed) {
            return GardenState.BLOOMED;
        }
        if (stemGrown) {
            return GardenState.STEM_GROWN;
        }
        if (sunlightAccepted) {
            return GardenState.SUNLIGHT_READY;
        }
        if (soilPrepared) {
            return GardenState.SOIL_READY;
        }
        return GardenState.EMPTY;
    }
}
