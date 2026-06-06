#pragma once

#include <QLoggingCategory>
#include <QString>

// Logging category for everything in this plugin. Enabled + tee'd to a file by
// HadokuLog::install() so failures can be diagnosed from the log alone, without
// screenshots or a terminal.
Q_DECLARE_LOGGING_CATEGORY(HadokuTask)

namespace HadokuLog
{
// Installs a message handler that appends hadoku.task.* messages to
// ~/.cache/hadoku-task/plugin.log (and forwards everything to the prior handler),
// and enables the category. Safe to call once at plugin load.
void install();

// Absolute path of the log file.
QString logFilePath();
}
