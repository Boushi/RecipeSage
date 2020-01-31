#!/bin/bash

set -e

if [ -z "$1" ] || [ -z "$2" ]
then
    echo "Invalid command. Usage: ./deploy_tag.sh api|static|static-beta|all 1.0.0"
    exit 1
fi

echo "==== PROD DEPLOYMENT ===="
read -p "Do you want to continue to deploy to prod? REMINDER: SET KUBE CLUSTER [yN] " -n 1 -r
echo
if [[ $REPLY =~ ^[Y]$  ]]
then
    echo "Continuing to deploy"
else
    exit 0
fi

export RELEASE_TAG="$2"

if [ "$1" == "api" ] || [ "$1" == "all" ]
then
    envsubst < kube/configs/api.yml | kubectl apply -f -
fi

if [ "$1" == "all" ]
then
    sleep 5s # Wait for changes to propagate
fi

if [ "$1" == "static" ] || [ "$1" == "all" ]
then
    envsubst < kube/configs/static.yml | kubectl apply -f -
fi

if [ "$1" == "static-beta" ] || [ "$1" == "all" ]
then
    envsubst < kube/configs/static-beta.yml | kubectl apply -f -
fi
