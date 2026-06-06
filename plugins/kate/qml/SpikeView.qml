// Phase-1 embedding spike. NOT the real UI — a deliberately minimal Kirigami
// scene whose only job is to prove the QQuickWidget-in-Kate-tool-view path:
//   - the tool view appears and renders Kirigami chrome
//   - focus enters/leaves cleanly when tabbing between Kate and this view
//   - the text field accepts keyboard input (and IME)
//   - HiDPI scaling and render flush look correct
// Once this is smooth, replace it with TasksToolView / CalendarToolView.
import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kirigami as Kirigami

Kirigami.Page {
    title: i18n("Hadoku — Kirigami spike")

    ColumnLayout {
        anchors.fill: parent
        spacing: Kirigami.Units.largeSpacing

        Kirigami.Heading {
            level: 3
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
            text: i18n("QQuickWidget + Kirigami inside a Kate tool view")
        }

        QQC2.Label {
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
            text: i18n("Tab in, type below, tab back out. Focus and input must work cleanly.")
        }

        QQC2.TextField {
            id: probe
            Layout.fillWidth: true
            placeholderText: i18n("Type here to test focus / IME…")
        }

        QQC2.Button {
            text: i18n("Click test")
            onClicked: probe.text = i18n("clicked at %1", Qt.formatTime(new Date()))
        }

        // Pushes everything to the top; verifies the scene fills the tool view.
        Item {
            Layout.fillHeight: true
        }
    }
}
