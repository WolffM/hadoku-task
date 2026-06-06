// One agenda row: time gutter (start + duration, or "All day") + a card with a
// tag-colored accent bar, title, time range, tag chips, and complete/delete.
// Uses the global `taskApi` context property for actions.
import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kirigami as Kirigami

RowLayout {
    id: root
    property var task
    readonly property bool allDay: !task.startTime || task.startTime.length === 0
    spacing: Kirigami.Units.smallSpacing

    function tagColor(tag) {
        if (!tag)
            return Kirigami.Theme.highlightColor;
        var h = 0;
        for (var i = 0; i < tag.length; ++i)
            h = (h * 31 + tag.charCodeAt(i)) & 0xffffff;
        return Qt.hsla((h % 360) / 360, 0.55, 0.5, 1.0);
    }
    function splitTags(s) { return s ? s.split(" ").filter(Boolean) : []; }
    function fmtT(iso) { var d = new Date(iso); return isNaN(d.getTime()) ? "" : Qt.formatTime(d, "h:mm AP"); }
    function fmtShort(iso) { var d = new Date(iso); return isNaN(d.getTime()) ? "" : Qt.formatTime(d, "h:mm"); }
    function durationStr(s, e) {
        if (!s || !e)
            return "";
        var mins = Math.round((new Date(e) - new Date(s)) / 60000);
        if (mins <= 0)
            return "";
        var h = Math.floor(mins / 60), m = mins % 60;
        return (h ? h + "h" : "") + (h && m ? " " : "") + (m ? m + "m" : "");
    }

    // Time gutter
    ColumnLayout {
        Layout.preferredWidth: Kirigami.Units.gridUnit * 2.6
        Layout.maximumWidth: Kirigami.Units.gridUnit * 2.6
        Layout.alignment: Qt.AlignTop
        Layout.topMargin: Kirigami.Units.smallSpacing
        spacing: 0
        QQC2.Label {
            Layout.alignment: Qt.AlignRight
            text: root.allDay ? i18n("All day") : root.fmtShort(task.startTime)
            font.bold: true
            font.pointSize: Kirigami.Theme.smallFont.pointSize
            horizontalAlignment: Text.AlignRight
        }
        QQC2.Label {
            Layout.alignment: Qt.AlignRight
            visible: !root.allDay && text.length > 0
            text: root.durationStr(task.startTime, task.endTime)
            opacity: 0.6
            font: Kirigami.Theme.smallFont
        }
    }

    // Card
    Rectangle {
        Layout.fillWidth: true
        Layout.topMargin: 2
        Layout.bottomMargin: 2
        radius: 5
        implicitHeight: cardRow.implicitHeight + Kirigami.Units.smallSpacing * 2
        color: cardHover.hovered ? Kirigami.Theme.alternateBackgroundColor
                                 : Qt.alpha(root.tagColor(root.splitTags(task.tag)[0] || ""), 0.10)

        HoverHandler { id: cardHover }

        RowLayout {
            id: cardRow
            anchors.fill: parent
            anchors.margins: Kirigami.Units.smallSpacing
            spacing: Kirigami.Units.smallSpacing

            // accent bar
            Rectangle {
                Layout.fillHeight: true
                Layout.preferredWidth: 3
                radius: 2
                color: root.tagColor(root.splitTags(task.tag)[0] || "")
            }

            ColumnLayout {
                Layout.fillWidth: true
                spacing: 2
                QQC2.Label {
                    Layout.fillWidth: true
                    text: task.title
                    font.bold: true
                    elide: Text.ElideRight
                }
                RowLayout {
                    Layout.fillWidth: true
                    spacing: Kirigami.Units.smallSpacing
                    visible: !root.allDay || root.splitTags(task.tag).length > 0
                    QQC2.Label {
                        visible: !root.allDay
                        text: root.fmtT(task.startTime) + (task.endTime ? " – " + root.fmtT(task.endTime) : "")
                        opacity: 0.7
                        font: Kirigami.Theme.smallFont
                    }
                    Item { Layout.fillWidth: true }
                    Repeater {
                        model: root.splitTags(task.tag)
                        Rectangle {
                            radius: height / 2
                            color: root.tagColor(modelData)
                            implicitHeight: cl.implicitHeight + 2
                            implicitWidth: cl.implicitWidth + Kirigami.Units.smallSpacing * 2
                            QQC2.Label {
                                id: cl
                                anchors.centerIn: parent
                                text: modelData
                                color: "white"
                                font: Kirigami.Theme.smallFont
                            }
                        }
                    }
                }
            }

            QQC2.ToolButton {
                icon.name: "checkmark"
                opacity: cardHover.hovered ? 1 : 0.3
                QQC2.ToolTip.text: i18n("Complete")
                QQC2.ToolTip.visible: hovered
                onClicked: taskApi.completeTask(task.id)
            }
            QQC2.ToolButton {
                icon.name: "edit-delete"
                opacity: cardHover.hovered ? 1 : 0.3
                QQC2.ToolTip.text: i18n("Delete")
                QQC2.ToolTip.visible: hovered
                onClicked: taskApi.deleteTask(task.id)
            }
        }
    }
}
