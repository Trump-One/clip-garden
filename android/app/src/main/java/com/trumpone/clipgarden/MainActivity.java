package com.trumpone.clipgarden;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.database.Cursor;
import android.database.SQLException;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputFilter;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.CursorAdapter;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final int PAPER = 0xfff8f3e4;
    private static final int INK = 0xff34433d;
    private static final int MUTED = 0xff51674e;
    private static final int MINT = 0xffc4dfcf;
    private static final int CREAM = 0xfffffdf6;
    private static final int MAX_TEXT_LENGTH = 16_384;

    private GardenStore garden;
    private ClipboardManager clipboard;
    private CursorAdapter entries;
    private EditText search;
    private TextView empty;
    private Button sort;
    private boolean frequent;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        garden = new GardenStore(this);
        clipboard = getSystemService(ClipboardManager.class);
        frequent = state != null && state.getBoolean("frequent");

        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(PAPER);
        page.setFocusableInTouchMode(true);
        page.setOnApplyWindowInsetsListener((view, insets) -> {
            Insets safe = Build.VERSION.SDK_INT >= 30
                    ? insets.getInsets(WindowInsets.Type.systemBars()
                            | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime())
                    : Insets.of(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                            insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            view.setPadding(safe.left + dp(20), safe.top + dp(16),
                    safe.right + dp(20), safe.bottom);
            return WindowInsets.CONSUMED;
        });
        setContentView(page);

        TextView title = text(29, INK);
        title.setTypeface(null, Typeface.BOLD);
        title.setText(R.string.app_name);
        title.setAccessibilityHeading(true);
        page.addView(title);
        TextView note = text(14, MUTED);
        note.setText(R.string.local_note);
        page.addView(note);

        Button paste = button(R.string.paste, MINT);
        paste.setOnClickListener(view -> paste());
        addSpaced(page, paste, 16);

        search = new EditText(this);
        search.setSingleLine(true);
        search.setFilters(new InputFilter[]{new InputFilter.LengthFilter(256)});
        search.setTextColor(INK);
        search.setHintTextColor(MUTED);
        search.setHint(R.string.search);
        search.setBackground(panel(CREAM));
        search.setPadding(dp(12), 0, dp(12), 0);
        search.setMinHeight(dp(48));
        search.setText(state == null ? "" : state.getString("query", ""));
        addSpaced(page, search, 8);

        sort = button(R.string.recent, CREAM);
        sort.setOnClickListener(view -> {
            frequent = !frequent;
            refresh();
        });
        addSpaced(page, sort, 8);

        empty = text(15, MUTED);
        empty.setPadding(dp(8), dp(16), dp(8), dp(16));
        page.addView(empty);

        ListView list = new ListView(this);
        list.setDivider(null);
        entries = new CursorAdapter(this, null, 0) {
            @Override
            public View newView(android.content.Context context, Cursor cursor, ViewGroup parent) {
                LinearLayout row = new LinearLayout(context);
                row.setOrientation(LinearLayout.VERTICAL);
                row.setPadding(dp(4), dp(12), dp(4), dp(12));
                TextView body = text(17, INK);
                body.setMaxLines(3);
                body.setEllipsize(TextUtils.TruncateAt.END);
                row.addView(body);
                row.addView(text(13, MUTED));
                return row;
            }

            @Override
            public void bindView(View view, android.content.Context context, Cursor cursor) {
                LinearLayout row = (LinearLayout) view;
                ((TextView) row.getChildAt(0)).setText(cursor.getString(1));
                ((TextView) row.getChildAt(1)).setText(getString(R.string.count, cursor.getLong(3)));
            }
        };
        list.setAdapter(entries);
        list.setOnItemClickListener((parent, view, position, id) -> {
            Cursor row = (Cursor) entries.getItem(position);
            showEntry(id, row.getString(1));
        });
        list.setEmptyView(empty);
        page.addView(list, new LinearLayout.LayoutParams(-1, 0, 1));
        search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence value, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence value, int start, int before, int count) {
                refresh();
            }
            @Override public void afterTextChanged(Editable value) {}
        });

        page.requestFocus();
        if (state == null) offerShare(getIntent());
    }

    @Override
    protected void onResume() {
        super.onResume();
        refresh();
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putBoolean("frequent", frequent);
        state.putString("query", search.getText().toString());
    }

    @Override
    protected void onDestroy() {
        entries.changeCursor(null);
        garden.close();
        super.onDestroy();
    }

    private void paste() {
        try {
            ClipData clip = clipboard.getPrimaryClip();
            if (clip == null || clip.getItemCount() == 0) {
                notifyUser(R.string.no_text);
                return;
            }
            ClipDescription description = clip.getDescription();
            if (description.getExtras() != null
                    && description.getExtras().getBoolean("android.content.extra.IS_SENSITIVE")) {
                notifyUser(R.string.sensitive);
                return;
            }
            CharSequence value = clip.getItemAt(0).getText();
            if (valid(value)) collect(value.toString(), R.string.saved);
        } catch (SecurityException | IllegalStateException error) {
            notifyUser(R.string.read_error);
        }
    }

    private void offerShare(Intent intent) {
        if (!Intent.ACTION_SEND.equals(intent.getAction()) || !"text/plain".equals(intent.getType())) {
            return;
        }
        CharSequence value = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (!valid(value)) return;

        String text = value.toString();
        String preview = text.length() > 280 ? text.substring(0, 280) + "…" : text;
        new AlertDialog.Builder(this)
                .setTitle(R.string.share_title)
                .setMessage(preview)
                .setNegativeButton(android.R.string.cancel, null)
                .setPositiveButton(R.string.save, (dialog, which) -> collect(text, R.string.saved))
                .show();
    }

    private void showEntry(long id, String body) {
        new AlertDialog.Builder(this)
                .setMessage(body)
                .setNegativeButton(android.R.string.cancel, null)
                .setNeutralButton(R.string.delete, (dialog, which) -> confirmDelete(id))
                .setPositiveButton(R.string.copy, (dialog, which) -> {
                    try {
                        clipboard.setPrimaryClip(ClipData.newPlainText(getString(R.string.app_name), body));
                    } catch (SecurityException | IllegalStateException error) {
                        notifyUser(R.string.copy_error);
                        return;
                    }
                    collect(body, Build.VERSION.SDK_INT < 33 ? R.string.copied : 0);
                })
                .show();
    }

    private void confirmDelete(long id) {
        new AlertDialog.Builder(this)
                .setTitle(R.string.delete_title)
                .setNegativeButton(android.R.string.cancel, null)
                .setPositiveButton(R.string.delete, (dialog, which) -> {
                    try {
                        garden.delete(id);
                        refresh();
                    } catch (SQLException error) {
                        notifyUser(R.string.storage_error);
                    }
                })
                .show();
    }

    private boolean valid(CharSequence value) {
        if (value == null || value.length() == 0) {
            notifyUser(R.string.no_text);
        } else if (value.length() > MAX_TEXT_LENGTH) {
            notifyUser(R.string.too_long);
        } else if (value.toString().trim().isEmpty()) {
            notifyUser(R.string.no_text);
        } else {
            return true;
        }
        return false;
    }

    private void collect(String value, int message) {
        try {
            garden.collect(value);
            refresh();
            if (message != 0) notifyUser(message);
        } catch (SQLException error) {
            notifyUser(R.string.storage_error);
        }
    }

    private void refresh() {
        String query = search.getText().toString().trim();
        empty.setText(query.isEmpty() ? R.string.empty : R.string.no_matches);
        sort.setText(frequent ? R.string.frequent : R.string.recent);
        try {
            entries.changeCursor(garden.list(query, frequent));
        } catch (SQLException error) {
            notifyUser(R.string.storage_error);
        }
    }

    private TextView text(int size, int color) {
        TextView view = new TextView(this);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private Button button(int label, int color) {
        Button view = new Button(this);
        view.setText(label);
        view.setTextColor(INK);
        view.setAllCaps(false);
        view.setMinHeight(dp(48));
        view.setBackground(new android.graphics.drawable.RippleDrawable(
                ColorStateList.valueOf(0x2234433d), panel(color), null));
        return view;
    }

    private GradientDrawable panel(int color) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(color);
        shape.setCornerRadius(dp(12));
        shape.setStroke(dp(1), 0xffb4bdb0);
        return shape;
    }

    private void addSpaced(LinearLayout parent, View child, int margin) {
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(-1, -2);
        layout.topMargin = dp(margin);
        parent.addView(child, layout);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void notifyUser(int message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }
}
