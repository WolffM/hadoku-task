// Calendar tool view — agenda list (Variant C). Scheduled tasks grouped by day
// (Today / Tomorrow / weekday), time gutter + cards, tag accent + chips, and a
// "now" marker in today's group. Backed by taskApi (context property): reads
// taskApi.tasks, creates via createScheduledTask, complete/deleteTask.
import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kirigami as Kirigami

Kirigami.Page {
    id: page
    padding: 0
    title: i18n("Calendar")

    // Bumped every minute so the "now" marker + relative day labels stay current.
    property int nowTick: 0
    Timer { interval: 60000; running: true; repeat: true; onTriggered: page.nowTick++ }

    function pad(n) { return (n < 10 ? "0" : "") + n; }
    function dayStr(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
    function dayFromISO(iso) { var d = new Date(iso); return isNaN(d.getTime()) ? "" : dayStr(d); }
    function todayStr() { return dayStr(new Date()); }

    function tagColor(tag) {
        if (!tag)
            return Kirigami.Theme.highlightColor;
        var h = 0;
        for (var i = 0; i < tag.length; ++i)
            h = (h * 31 + tag.charCodeAt(i)) & 0xffffff;
        return Qt.hsla((h % 360) / 360, 0.55, 0.5, 1.0);
    }
    function firstTag(tagStr) {
        var a = tagStr ? tagStr.split(" ").filter(Boolean) : [];
        return a.length ? a[0] : "";
    }
    function splitTags(s) { return s ? s.split(" ").filter(Boolean) : []; }

    function fmtT(iso) {
        var d = new Date(iso);
        return isNaN(d.getTime()) ? "" : Qt.formatTime(d, "h:mm AP");
    }
    function fmtTshort(iso) {
        var d = new Date(iso);
        return isNaN(d.getTime()) ? "" : Qt.formatTime(d, "h:mm");
    }
    function durationStr(s, e) {
        if (!s || !e)
            return "";
        var mins = Math.round((new Date(e) - new Date(s)) / 60000);
        if (mins <= 0)
            return "";
        var h = Math.floor(mins / 60), m = mins % 60;
        return (h ? h + "h" : "") + (h && m ? " " : "") + (m ? m + "m" : "");
    }

    function dayLabel(d) {
        var t = new Date();
        var tom = new Date();
        tom.setDate(tom.getDate() + 1);
        var date = new Date(d + "T00:00:00");
        var pretty = Qt.formatDate(date, "ddd MMM d");
        if (d === dayStr(t))
            return i18n("Today · %1", pretty);
        if (d === dayStr(tom))
            return i18n("Tomorrow · %1", pretty);
        return pretty;
    }

    function minutesOf(iso) {
        var d = new Date(iso);
        return d.getHours() * 60 + d.getMinutes();
    }

    // Agenda: [{ day, label, isToday, nowIndex, items:[task...] }, ...]
    readonly property var agenda: {
        page.nowTick; // dependency so this recomputes each minute
        var filter = taskApi.filterTag; // shared with the Tasks tab
        var groups = {};
        var all = taskApi.tasks;
        for (var i = 0; i < all.length; ++i) {
            var t = all[i];
            if (filter && page.splitTags(t.tag).indexOf(filter) < 0)
                continue;
            var day = (t.date && t.date.length) ? t.date : (t.startTime ? page.dayFromISO(t.startTime) : "");
            if (!day)
                continue;
            (groups[day] = groups[day] || []).push(t);
        }
        var days = Object.keys(groups).sort();
        var today = page.todayStr();
        var nowMin = (function () { var n = new Date(); return n.getHours() * 60 + n.getMinutes(); })();
        var out = [];
        for (var k = 0; k < days.length; ++k) {
            var d = days[k];
            var items = groups[d];
            items.sort(function (a, b) {
                var aAll = !a.startTime, bAll = !b.startTime;
                if (aAll !== bAll)
                    return aAll ? -1 : 1;
                return (a.startTime || "").localeCompare(b.startTime || "");
            });
            var isToday = (d === today);
            var nowIndex = -1;
            if (isToday) {
                nowIndex = items.length; // default: after everything (all past)
                for (var j = 0; j < items.length; ++j) {
                    if (items[j].startTime && page.minutesOf(items[j].startTime) >= nowMin) {
                        nowIndex = j;
                        break;
                    }
                }
            }
            out.push({ day: d, label: page.dayLabel(d), isToday: isToday, nowIndex: nowIndex, items: items });
        }
        return out;
    }

    function defaultSlot() {
        var d = new Date();
        var sh = Math.min(d.getHours() + 1, 23);
        var s = new Date(d); s.setHours(sh, 0, 0, 0);
        var e = new Date(s); e.setHours(Math.min(sh + 1, 23), sh + 1 >= 24 ? 59 : 0, 0, 0);
        return { start: s.toISOString(), end: e.toISOString() };
    }

    Component {
        id: nowMarker
        RowLayout {
            width: parent ? parent.width : 0
            spacing: Kirigami.Units.smallSpacing
            QQC2.Label {
                text: Qt.formatTime(new Date(), "h:mm")
                color: Kirigami.Theme.negativeTextColor
                font.pointSize: Kirigami.Theme.smallFont.pointSize
                font.bold: true
            }
            Rectangle {
                Layout.fillWidth: true
                height: 2
                color: Kirigami.Theme.negativeTextColor
            }
        }
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        TaskToolbar {
            Layout.fillWidth: true
            placeholder: i18n("Schedule a task…")
            onSubmitText: text => {
                var slot = page.defaultSlot();
                taskApi.createScheduledTask(text, "", slot.start, slot.end);
            }
        }

        Kirigami.Separator { Layout.fillWidth: true }

        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true

            // Centered empty state (matches the Tasks tab).
            Kirigami.PlaceholderMessage {
                anchors.centerIn: parent
                width: parent.width - Kirigami.Units.gridUnit * 4
                visible: page.agenda.length === 0
                icon.name: "view-calendar-day"
                text: i18n("Nothing scheduled")
                explanation: i18n("Add a task above, or schedule one from the Tasks tab.")
            }

            QQC2.ScrollView {
                anchors.fill: parent
                visible: page.agenda.length > 0
                clip: true

                ColumnLayout {
                    width: page.width
                    spacing: 0

                Repeater {
                    model: page.agenda
                    delegate: ColumnLayout {
                        id: groupDelegate
                        required property var modelData
                        readonly property var group: modelData
                        Layout.fillWidth: true
                        spacing: 0

                        // Day header
                        RowLayout {
                            Layout.fillWidth: true
                            Layout.topMargin: Kirigami.Units.largeSpacing
                            Layout.leftMargin: Kirigami.Units.smallSpacing
                            Layout.rightMargin: Kirigami.Units.smallSpacing
                            Layout.bottomMargin: Kirigami.Units.smallSpacing
                            QQC2.Label {
                                text: groupDelegate.group.label.toUpperCase()
                                font: Kirigami.Theme.smallFont
                                opacity: 0.7
                            }
                            Item { Layout.fillWidth: true }
                            QQC2.Label {
                                text: groupDelegate.group.items.length
                                font: Kirigami.Theme.smallFont
                                opacity: 0.5
                            }
                        }

                        // Items, with the "now" marker spliced in
                        Repeater {
                            model: groupDelegate.group.items
                            delegate: ColumnLayout {
                                id: itemDelegate
                                required property int index
                                required property var modelData
                                Layout.fillWidth: true
                                spacing: 0

                                Loader {
                                    Layout.fillWidth: true
                                    Layout.leftMargin: Kirigami.Units.gridUnit * 3
                                    Layout.rightMargin: Kirigami.Units.smallSpacing
                                    Layout.topMargin: Kirigami.Units.smallSpacing
                                    Layout.bottomMargin: Kirigami.Units.smallSpacing
                                    active: groupDelegate.group.isToday
                                            && groupDelegate.group.nowIndex === itemDelegate.index
                                    sourceComponent: nowMarker
                                }

                                CalendarAgendaRow {
                                    Layout.fillWidth: true
                                    task: itemDelegate.modelData
                                }
                            }
                        }

                        // "now" marker at the end (every slot today is in the past)
                        Loader {
                            Layout.fillWidth: true
                            Layout.leftMargin: Kirigami.Units.gridUnit * 3
                            Layout.rightMargin: Kirigami.Units.smallSpacing
                            Layout.topMargin: Kirigami.Units.smallSpacing
                            active: groupDelegate.group.isToday
                                    && groupDelegate.group.nowIndex === groupDelegate.group.items.length
                            sourceComponent: nowMarker
                        }
                    }
                }

                    Item { Layout.fillHeight: true; Layout.preferredHeight: Kirigami.Units.gridUnit }
                }
            }
        }
    }

    Component.onCompleted: taskApi.logUi("CalendarToolView loaded")
}
