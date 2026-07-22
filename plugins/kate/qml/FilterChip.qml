// Pill-shaped toggle used for the tag filter row. Doubles as a drop target so a
// task dragged onto it gets that tag assigned.
import QtQuick
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

QQC2.AbstractButton {
    id: chip
    property string label: ""
    property string tagValue: ""        // actual tag ("" for the All chip — not a drop target)
    property string boardValue: ""      // board id (set for board chips — a move target)
    property color accent: Kirigami.Theme.highlightColor
    property bool active: false
    property bool dropHover: false

    // Emitted when a task is dropped on a tag chip (assigns the tag).
    signal taskDropped(string taskId, string currentTags)
    // Emitted when a task is dropped on a board chip (moves it; tags travel along).
    signal taskMovedToBoard(string taskId, string currentTags)
    // Emitted on right-click (used to delete the tag everywhere).
    signal deleteRequested(string tag)

    TapHandler {
        acceptedButtons: Qt.RightButton
        onTapped: if (chip.tagValue.length > 0) chip.deleteRequested(chip.tagValue)
    }

    implicitHeight: lbl.implicitHeight + Kirigami.Units.smallSpacing
    implicitWidth: lbl.implicitWidth + Kirigami.Units.largeSpacing
    hoverEnabled: true

    background: Rectangle {
        radius: height / 2
        color: chip.dropHover ? chip.accent
             : chip.active ? chip.accent
             : (chip.hovered ? Qt.alpha(chip.accent, 0.18) : "transparent")
        border.color: chip.accent
        border.width: chip.dropHover ? 2 : 1
    }
    contentItem: QQC2.Label {
        id: lbl
        text: chip.label
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
        color: (chip.active || chip.dropHover) ? "white" : chip.accent
        font: Kirigami.Theme.smallFont
    }

    DropArea {
        anchors.fill: parent
        enabled: chip.tagValue.length > 0 || chip.boardValue.length > 0
        onEntered: chip.dropHover = true
        onExited: chip.dropHover = false
        onDropped: drop => {
            chip.dropHover = false;
            if (!drop.source || drop.source.dragTaskId === undefined)
                return;
            if (chip.boardValue.length > 0)
                chip.taskMovedToBoard(drop.source.dragTaskId, drop.source.dragTags || "");
            else
                chip.taskDropped(drop.source.dragTaskId, drop.source.dragTags || "");
        }
    }
}
