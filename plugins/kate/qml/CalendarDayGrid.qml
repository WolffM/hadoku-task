// Day-timeline grid for the Calendar tab. Timed tasks are blocks positioned and
// sized by time (proportional height). Drag the body to move (keeps duration),
// drag the top/bottom edge to resize — all snapped to 15 minutes, committed via
// taskApi.setTaskSchedule. Backed by the shared taskApi (taskApi.tasks).
import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kirigami as Kirigami

Item {
    id: grid
    property date selectedDate: new Date()
    property real hourHeight: Kirigami.Units.gridUnit * 3
    readonly property real gutterW: Kirigami.Units.gridUnit * 2.5
    property int nowTick: 0

    Timer { interval: 60000; running: true; repeat: true; onTriggered: grid.nowTick++ }

    function pad(n) { return (n < 10 ? "0" : "") + n; }
    function dayStr(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
    function dayFromISO(iso) { var d = new Date(iso); return isNaN(d.getTime()) ? "" : dayStr(d); }
    function minutesOf(iso) { var d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); }
    function snap15(m) { return Math.round(m / 15) * 15; }
    function tagColor(tag) {
        if (!tag) return Kirigami.Theme.highlightColor;
        var h = 0;
        for (var i = 0; i < tag.length; ++i) h = (h * 31 + tag.charCodeAt(i)) & 0xffffff;
        return Qt.hsla((h % 360) / 360, 0.55, 0.5, 1.0);
    }
    function firstTag(t) { var a = t ? t.split(" ").filter(Boolean) : []; return a.length ? a[0] : ""; }
    function fmtMin(totalMin) {
        var h = Math.floor(totalMin / 60) % 24, m = totalMin % 60;
        var d = new Date(grid.selectedDate); d.setHours(h, m, 0, 0);
        return Qt.formatTime(d, "h:mm AP");
    }
    // ISO timestamp for a minutes-since-midnight on the selected day.
    function isoAt(totalMin) {
        var d = new Date(grid.selectedDate);
        d.setHours(Math.floor(totalMin / 60), totalMin % 60, 0, 0);
        return d.toISOString();
    }
    function commit(id, startMin, endMin) {
        startMin = Math.max(0, Math.min(startMin, 24 * 60 - 15));
        endMin = Math.max(startMin + 15, Math.min(endMin, 24 * 60));
        taskApi.logUi("grid commit " + id + " " + startMin + "->" + endMin);
        // Store the local day explicitly so it matches local-time display.
        taskApi.setTaskSchedule(id, grid.dayStr(grid.selectedDate), grid.isoAt(startMin), grid.isoAt(endMin));
    }

    // Timed tasks for the selected day.
    readonly property var dayTasks: {
        grid.nowTick;
        var out = [];
        var target = grid.dayStr(grid.selectedDate);
        var all = taskApi.tasks;
        for (var i = 0; i < all.length; ++i) {
            var t = all[i];
            if (!t.startTime)
                continue;
            // Timed task: its day is startTime in LOCAL time. The server's `date`
            // is backfilled in UTC, so don't trust it for timed tasks.
            var day = grid.dayFromISO(t.startTime);
            if (day === target)
                out.push(t);
        }
        return out;
    }

    // Column packing for overlapping tasks: id -> { col, cols }. Clusters of
    // mutually-overlapping tasks are found by a start-time sweep, but WITHIN a
    // cluster columns are assigned by "last touched" (updatedAt, else createdAt) —
    // so the task you just dragged in lands in the next column to the right, like a
    // stack, while the ones already there keep their columns. cols = the cluster's
    // max concurrency. Based on committed times (stable during a drag).
    readonly property var layout: {
        var items = grid.dayTasks.map(function (t) {
            var s = grid.minutesOf(t.startTime);
            var e = t.endTime ? grid.minutesOf(t.endTime) : s + 60;
            var key = (t.updatedAt && t.updatedAt.length ? t.updatedAt
                       : (t.createdAt && t.createdAt.length ? t.createdAt : t.id));
            return { id: t.id, s: s, e: Math.max(e, s + 15), key: key };
        }).sort(function (a, b) { return a.s - b.s || a.e - b.e; });

        var res = {};
        var cluster = [];
        var clusterEnd = -1;
        function flush() {
            // Left→right order = last-touched (newest to the right); id breaks ties.
            cluster.sort(function (a, b) {
                if (a.key !== b.key) return a.key < b.key ? -1 : 1;
                return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
            });
            var cols = []; // each column = list of placed intervals
            for (var i = 0; i < cluster.length; ++i) {
                var it = cluster[i];
                var c = 0;
                for (;; ++c) {
                    if (c >= cols.length) { cols.push([it]); it.col = c; break; }
                    var clash = false;
                    for (var m = 0; m < cols[c].length; ++m) {
                        var x = cols[c][m];
                        if (it.s < x.e && x.s < it.e) { clash = true; break; }
                    }
                    if (!clash) { cols[c].push(it); it.col = c; break; }
                }
            }
            for (var j = 0; j < cluster.length; ++j)
                res[cluster[j].id] = { col: cluster[j].col, cols: cols.length };
            cluster = [];
        }
        for (var i = 0; i < items.length; ++i) {
            var t = items[i];
            if (cluster.length > 0 && t.s >= clusterEnd)
                flush();
            cluster.push(t);
            clusterEnd = cluster.length === 1 ? t.e : Math.max(clusterEnd, t.e);
        }
        flush();
        return res;
    }

    function scrollToInteresting() {
        var targetMin;
        if (grid.dayStr(grid.selectedDate) === grid.dayStr(new Date()))
            targetMin = (new Date()).getHours() * 60;
        else if (grid.dayTasks.length > 0)
            targetMin = grid.minutesOf(grid.dayTasks[0].startTime);
        else
            targetMin = 8 * 60;
        var y = Math.max(0, targetMin / 60 * grid.hourHeight - grid.hourHeight);
        if (sv.contentItem)
            sv.contentItem.contentY = y;
    }
    onSelectedDateChanged: scrollToInteresting()
    Component.onCompleted: scrollToInteresting()

    QQC2.ScrollView {
        id: sv
        anchors.fill: parent
        clip: true
        contentWidth: availableWidth

        Item {
            width: grid.width
            implicitHeight: 24 * grid.hourHeight

            // Hour lines + gutter labels
            Repeater {
                model: 24
                Item {
                    y: index * grid.hourHeight
                    width: grid.width
                    height: grid.hourHeight
                    Kirigami.Separator {
                        width: parent.width - grid.gutterW
                        x: grid.gutterW
                        anchors.top: parent.top
                        opacity: 0.4
                    }
                    QQC2.Label {
                        x: 0
                        y: -implicitHeight / 2
                        width: grid.gutterW - Kirigami.Units.smallSpacing
                        horizontalAlignment: Text.AlignRight
                        visible: index > 0
                        text: {
                            var h = index % 12; if (h === 0) h = 12;
                            return h + (index < 12 ? "am" : "pm");
                        }
                        font: Kirigami.Theme.smallFont
                        opacity: 0.6
                    }
                }
            }

            // Now marker (only when viewing today)
            Rectangle {
                visible: grid.dayStr(grid.selectedDate) === grid.dayStr(new Date()) && (grid.nowTick >= 0)
                x: grid.gutterW
                width: parent.width - grid.gutterW
                height: 2
                color: Kirigami.Theme.negativeTextColor
                y: {
                    grid.nowTick;
                    var n = new Date();
                    return (n.getHours() * 60 + n.getMinutes()) / 60 * grid.hourHeight - 1;
                }
                z: 10
            }

            // Task blocks
            Repeater {
                model: grid.dayTasks
                delegate: Item {
                    id: block
                    required property var modelData
                    readonly property string taskId: modelData.id
                    property int baseStart: grid.minutesOf(modelData.startTime)
                    property int baseEnd: modelData.endTime ? grid.minutesOf(modelData.endTime) : baseStart + 60
                    property int curStart: baseStart
                    property int curEnd: baseEnd
                    // reset preview if the model changes underneath us
                    onBaseStartChanged: curStart = baseStart
                    onBaseEndChanged: curEnd = baseEnd

                    // Column placement for overlaps.
                    readonly property var lay: grid.layout[modelData.id] || ({ col: 0, cols: 1 })
                    readonly property real laneX: grid.gutterW + Kirigami.Units.smallSpacing
                    readonly property real laneW: parent.width - laneX - Kirigami.Units.smallSpacing
                    readonly property real colGap: lay.cols > 1 ? Kirigami.Units.smallSpacing : 0

                    x: laneX + lay.col * (laneW / lay.cols)
                    width: laneW / lay.cols - colGap
                    y: curStart / 60 * grid.hourHeight
                    height: Math.max((curEnd - curStart) / 60 * grid.hourHeight, Kirigami.Units.gridUnit)

                    Rectangle {
                        anchors.fill: parent
                        radius: 4
                        color: Qt.alpha(grid.tagColor(grid.firstTag(modelData.tag)), dragDh.active ? 0.5 : 0.28)
                        border.width: 1
                        border.color: grid.tagColor(grid.firstTag(modelData.tag))

                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: Kirigami.Units.smallSpacing
                            spacing: 0
                            clip: true
                            QQC2.Label {
                                Layout.fillWidth: true
                                text: modelData.title
                                font.bold: true
                                elide: Text.ElideRight
                            }
                            QQC2.Label {
                                Layout.fillWidth: true
                                visible: block.height > Kirigami.Units.gridUnit * 2
                                text: grid.fmtMin(block.curStart) + " – " + grid.fmtMin(block.curEnd)
                                font: Kirigami.Theme.smallFont
                                opacity: 0.8
                                elide: Text.ElideRight
                            }
                        }
                    }

                    // One drag handler: press near the top edge → resize start,
                    // near the bottom edge → resize end, middle → move. A single
                    // handler avoids the edge/body grab competition that broke
                    // edge dragging.
                    DragHandler {
                        id: dragDh
                        target: null
                        property int mode: 0 // 0 = move, 1 = resize top, 2 = resize bottom
                        property int grabStart
                        property int grabEnd
                        property real edgeZone: Math.min(Kirigami.Units.gridUnit, block.height / 3)
                        onActiveChanged: {
                            if (active) {
                                grabStart = block.curStart;
                                grabEnd = block.curEnd;
                                var py = centroid.pressPosition.y; // relative to block at press
                                mode = py < edgeZone ? 1 : (py > block.height - edgeZone ? 2 : 0);
                            } else {
                                grid.commit(block.taskId, block.curStart, block.curEnd);
                            }
                        }
                        onCentroidChanged: if (active) {
                            var dm = grid.snap15((centroid.scenePosition.y - centroid.scenePressPosition.y) / grid.hourHeight * 60);
                            if (dragDh.mode === 1)
                                block.curStart = Math.min(grabStart + dm, block.curEnd - 15);
                            else if (dragDh.mode === 2)
                                block.curEnd = Math.max(grabEnd + dm, block.curStart + 15);
                            else {
                                block.curStart = grabStart + dm;
                                block.curEnd = grabEnd + dm;
                            }
                        }
                    }

                    // Cursor feedback on the resize edges (hover only — no grab).
                    Rectangle {
                        anchors { left: parent.left; right: parent.right; top: parent.top }
                        height: dragDh.edgeZone
                        color: "transparent"
                        HoverHandler { cursorShape: Qt.SizeVerCursor }
                    }
                    Rectangle {
                        anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
                        height: dragDh.edgeZone
                        color: "transparent"
                        HoverHandler { cursorShape: Qt.SizeVerCursor }
                    }
                }
            }
        }
    }
}
