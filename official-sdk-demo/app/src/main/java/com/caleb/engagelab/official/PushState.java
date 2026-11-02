package com.caleb.engagelab.official;

/** What the SDK has reported so far. Its callbacks arrive on the main thread, as does the screen. */
final class PushState {
    interface Listener {
        void onChanged();
    }

    static boolean connected;
    static String lastEvent;
    static Listener listener;

    private PushState() {
    }

    static void changed() {
        if (listener != null) listener.onChanged();
    }
}
