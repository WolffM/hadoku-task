#include "taskpluginview.h"

#include <KTextEditor/MainWindow>
#include <KTextEditor/Plugin>

#include <KLocalizedString>

#include <QIcon>
#include <QQuickStyle>
#include <QQuickWidget>
#include <QUrl>
#include <QVBoxLayout>
#include <QWidget>

TaskPluginView::TaskPluginView(KTextEditor::Plugin *plugin, KTextEditor::MainWindow *mainWindow)
    : QObject(plugin)
    , m_mainWindow(mainWindow)
{
    // Pin the Qt Quick Controls style so the embedded scene matches Kate's chrome.
    // Safe to call repeatedly; only the first call per process takes effect.
    QQuickStyle::setStyle(QStringLiteral("org.kde.desktop"));

    m_tasksToolView = createKirigamiToolView(plugin,
                                             QStringLiteral("hadoku_tasks"),
                                             QStringLiteral("view-task"),
                                             i18n("Tasks"),
                                             QStringLiteral("qrc:/qml/SpikeView.qml"));

    m_calendarToolView = createKirigamiToolView(plugin,
                                                QStringLiteral("hadoku_calendar"),
                                                QStringLiteral("view-calendar"),
                                                i18n("Calendar"),
                                                QStringLiteral("qrc:/qml/SpikeView.qml"));
}

TaskPluginView::~TaskPluginView()
{
    // Tool views are owned by the main window; delete explicitly so they vanish
    // when the plugin is unloaded mid-session.
    delete m_tasksToolView;
    delete m_calendarToolView;
}

QWidget *TaskPluginView::createKirigamiToolView(KTextEditor::Plugin *plugin,
                                                const QString &identifier,
                                                const QString &iconName,
                                                const QString &title,
                                                const QString &qmlResource)
{
    QWidget *toolView = m_mainWindow->createToolView(plugin,
                                                     identifier,
                                                     KTextEditor::MainWindow::Left,
                                                     QIcon::fromTheme(iconName),
                                                     title);

    auto *layout = new QVBoxLayout(toolView);
    layout->setContentsMargins(0, 0, 0, 0);

    auto *quickWidget = new QQuickWidget(toolView);
    quickWidget->setResizeMode(QQuickWidget::SizeRootObjectToView);
    // WA_AlwaysStackOnTop guards against the known QQuickWidget stacking quirk
    // (it is drawn before sibling non-OpenGL widgets). Part of what the spike checks.
    quickWidget->setAttribute(Qt::WA_AlwaysStackOnTop);
    quickWidget->setSource(QUrl(qmlResource));

    layout->addWidget(quickWidget);
    return toolView;
}
