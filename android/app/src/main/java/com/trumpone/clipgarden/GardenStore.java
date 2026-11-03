package com.trumpone.clipgarden;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

final class GardenStore extends SQLiteOpenHelper {
    GardenStore(Context context) {
        super(context, "garden.db", null, 1);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE clips (_id INTEGER PRIMARY KEY, body TEXT NOT NULL UNIQUE,"
                + " used_at INTEGER NOT NULL, uses INTEGER NOT NULL)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        throw new IllegalStateException("No migration from " + oldVersion + " to " + newVersion);
    }

    void collect(String text) {
        SQLiteDatabase db = getWritableDatabase();
        long now = System.currentTimeMillis();
        db.beginTransaction();
        try {
            ContentValues entry = new ContentValues();
            entry.put("body", text);
            entry.put("used_at", now);
            entry.put("uses", 0);
            db.insertWithOnConflict("clips", null, entry, SQLiteDatabase.CONFLICT_IGNORE);
            db.execSQL("UPDATE clips SET used_at = ?, uses = uses + 1 WHERE body = ?",
                    new Object[]{now, text});
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    Cursor list(String query, boolean frequent) {
        String order = frequent ? "uses DESC, used_at DESC, _id DESC" : "used_at DESC, _id DESC";
        return getReadableDatabase().query("clips", null, "instr(lower(body), lower(?)) > 0 OR ? = ''",
                new String[]{query, query}, null, null, order);
    }

    void delete(long id) {
        getWritableDatabase().delete("clips", "_id = ?", new String[]{Long.toString(id)});
    }
}
