#pragma once

#include <QString>
#include <QStringList>

/**
 * Hand-written mirror of the `Task` fields from src/domain/types.ts that the UI
 * needs. Kept deliberately small; a CI parity test (later) guards against drift
 * vs the published openapi.json.
 */
struct Task {
    QString id;
    QString title;
    QString tag;        // may be empty
    QString state;      // "Active" | "Completed" | "Deleted"
    QString createdAt;
    QString startTime;  // ISO 8601, may be empty
    QString endTime;    // ISO 8601, may be empty

    bool isScheduled() const { return !startTime.isEmpty(); }
};

struct Board {
    QString id;
    QString name;
    QStringList tags; // persistent board tag list (distinct from per-task tags)
};
