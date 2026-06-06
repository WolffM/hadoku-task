#include "taskplugin.h"
#include "logging.h"
#include "taskpluginview.h"

#include <KPluginFactory>

// Registers the plugin and embeds src/taskplugin.json as KPlugin metadata so
// Kate can discover it without a separate .desktop file.
K_PLUGIN_FACTORY_WITH_JSON(TaskPluginFactory, "taskplugin.json", registerPlugin<TaskPlugin>();)

TaskPlugin::TaskPlugin(QObject *parent, const QVariantList &args)
    : KTextEditor::Plugin(parent)
{
    Q_UNUSED(args)
    HadokuLog::install();
    qCInfo(HadokuTask) << "TaskPlugin loaded; log file:" << HadokuLog::logFilePath();
}

TaskPlugin::~TaskPlugin() = default;

QObject *TaskPlugin::createView(KTextEditor::MainWindow *mainWindow)
{
    qCInfo(HadokuTask) << "createView() for main window" << mainWindow;
    return new TaskPluginView(this, mainWindow);
}

#include "taskplugin.moc"
