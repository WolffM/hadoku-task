#pragma once

#include <QObject>
#include <QString>

/**
 * Resolves the user key the API client authenticates with.
 *
 * Lookup order:
 *   1. KWallet  — folder "hadoku-task", entry "userKey" (the intended secure store).
 *   2. QSettings fallback — <config>/hadoku-task.conf, [Auth] UserKey (dev convenience
 *      while iterating; lets us seed a test key without an interactive wallet unlock).
 *
 * The session-id mint (`POST /session/create` → KWallet token) from the design is a
 * later refinement; for now the raw key is sent as X-User-Key.
 */
class SessionManager : public QObject
{
    Q_OBJECT

public:
    explicit SessionManager(QObject *parent = nullptr);

    // Returns the user key, or an empty string if none is configured.
    QString userKey() const;
};
