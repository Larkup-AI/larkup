"""A transient read failure must not stop an explicitly awakened idle GPU."""
from .common import DomainError, canonical

def checkpoint(remote):
    try:
        remote.backup()
    except DomainError as error:
        if error.code != 'CONTROLLER_UNAVAILABLE':
            raise
        print(canonical({'warning': 'IDLE_BACKUP_DEFERRED', 'reason': error.code,
                         'action': 'Retrying next idle monitoring interval; GPU remains awake.'}), flush=True)
        return False
    return True

def monitoring_error(error):
    if error.code != 'CONTROLLER_UNAVAILABLE':
        raise error
    print(canonical({'warning':'CONTROLLER_POLL_DEFERRED','reason':error.code,
                     'action':'Retrying monitoring; GPU and in-flight calls remain running.'}),flush=True)
