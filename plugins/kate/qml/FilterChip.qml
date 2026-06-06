// Small pill-shaped toggle used for the tag filter row.
import QtQuick
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

QQC2.AbstractButton {
    id: chip
    property string label: ""
    property color accent: Kirigami.Theme.highlightColor
    property bool active: false

    implicitHeight: lbl.implicitHeight + Kirigami.Units.smallSpacing
    implicitWidth: lbl.implicitWidth + Kirigami.Units.largeSpacing
    hoverEnabled: true

    background: Rectangle {
        radius: height / 2
        color: chip.active ? chip.accent : (chip.hovered ? Qt.alpha(chip.accent, 0.18) : "transparent")
        border.color: chip.accent
        border.width: 1
    }
    contentItem: QQC2.Label {
        id: lbl
        text: chip.label
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
        color: chip.active ? "white" : chip.accent
        font: Kirigami.Theme.smallFont
    }
}
