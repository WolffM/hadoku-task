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

                    x: grid.gutterW + Kirigami.Units.smallSpacing
                    width: parent.width - x - Kirigami.Units.smallSpacing
                    y: curStart / 60 * grid.hourHeight
                    height: Math.max((curEnd - curStart) / 60 * grid.hourHeight, Kirigami.Units.gridUnit)

                    Rectangle {
                        anchors.fill: parent
                        radius: 4
                        color: Qt.alpha(grid.tagColor(grid.firstTag(modelData.tag)), moveDh.active ? 0.5 : 0.28)
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

                    // Move (body)
                    DragHandler {
                        id: moveDh
                        target: null
                        property int grabStart
                        property int grabEnd
                        onActiveChanged: {
                            if (active) { grabStart = block.curStart; grabEnd = block.curEnd; }
                            else grid.commit(block.taskId, block.curStart, block.curEnd);
                        }
                        onCentroidChanged: if (active) {
                            var dm = grid.snap15((centroid.scenePosition.y - centroid.scenePressPosition.y) / grid.hourHeight * 60);
                            block.curStart = grabStart + dm;
                            block.curEnd = grabEnd + dm;
                        }
                    }

                    // Resize: top edge → start
                    Rectangle {
                        anchors { left: parent.left; right: parent.right; top: parent.top }
                        height: Kirigami.Units.smallSpacing * 1.5
                        color: "transparent"
                        DragHandler {
                            target: null
                            property int grabStart
                            onActiveChanged: {
                                if (active) grabStart = block.curStart;
                                else grid.commit(block.taskId, block.curStart, block.curEnd);
                            }
                            onCentroidChanged: if (active) {
                                var dm = grid.snap15((centroid.scenePosition.y - centroid.scenePressPosition.y) / grid.hourHeight * 60);
                                block.curStart = Math.min(grabStart + dm, block.curEnd - 15);
                            }
                        }
                        HoverHandler { cursorShape: Qt.SizeVerCursor }
                    }
                    // Resize: bottom edge → end
                    Rectangle {
                        anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
                        height: Kirigami.Units.smallSpacing * 1.5
                        color: "transparent"
                        DragHandler {
                            target: null
                            property int grabEnd
                            onActiveChanged: {
                                if (active) grabEnd = block.curEnd;
                                else grid.commit(block.taskId, block.curStart, block.curEnd);
                            }
                            onCentroidChanged: if (active) {
                                var dm = grid.snap15((centroid.scenePosition.y - centroid.scenePressPosition.y) / grid.hourHeight * 60);
                                block.curEnd = Math.max(grabEnd + dm, block.curStart + 15);
                            }
                        }
                        HoverHandler { cursorShape: Qt.SizeVerCursor }
                    }
                }
            }
        }
    }
}
